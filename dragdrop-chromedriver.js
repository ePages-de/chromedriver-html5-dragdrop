/* eslint-env node,browser */

module.exports = function (webdriver, waitTime) {
    'use strict';

    /* Monkey patch `webdriver.ActionSequence`, overriding its `dragAndDrop` function with a fixed one */
    var dragAndDrop,
        originalActions = webdriver.actions;
    webdriver.actions = function () {
        var actionsInstance = originalActions.call(webdriver);
        actionsInstance.dragAndDrop = dragAndDrop;
        return actionsInstance;
    };

    function wait(x) {
        return waitTime ? webdriver.sleep(waitTime).then(() => x) : x;
    }

    function addPoints(a, b) {
        return {
            x: a.x + b.x,
            y: a.y + b.y
        };
    }

    function roundPoint(a) {
        return {
            x: Math.round(a.x),
            y: Math.round(a.y)
        };
    }

    function recoverFromStaleElementReferenceError (err) {
        // the source element might have been removed, so ignore this error here
        if (err.name !== 'StaleElementReferenceError') {
            throw err;
        }
    }

    function findElementFromElementOrAbsoluteLocation(elementOrAbsoluteLocation) {
        function getLocation(_location) {
            return _location.nodeType ? _location : document.elementFromPoint(_location.x, _location.y);
        }

        return webdriver.executeScript(getLocation, elementOrAbsoluteLocation).then(function (element) {
            if (element === null) {
                return Promise.reject(new Error('cannot find element at location ' +
                    JSON.stringify(elementOrAbsoluteLocation)));
            }
            return element;
        });
    }

    function findLocationFromElementOrRelativeLocation(elementOrRelativeLocation, anchorElement) {
        if (typeof elementOrRelativeLocation.getLocation === 'function') {
            return elementOrRelativeLocation.getLocation();
        }

        return anchorElement.getLocation().then(anchorLocation => addPoints(anchorLocation, elementOrRelativeLocation));
    }

    /**
     * Fixed `dragAndDrop` function that works in Chromedriver
     * by triggering the `dragstart`, `dragover`, `drop` and `dragend` events in the browser context.
     *
     * Because for security reasons synthetic drag events do not have a usable `dataTransfer` property,
     * all `dataTransfer` accesses in the tested code must be made conditional, for example like this:
     *
     *     if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
     *
     * See below the doc block of the original function, taken from here:
     * https://github.com/SeleniumHQ/selenium/blob/master/javascript/webdriver/actionsequence.js#L218
     *
     * Convenience function for performing a "drag and drop" manuever. The target
     * element may be moved to the location of another element, or by an offset (in
     * pixels).
     * @param {!webdriver.WebElement} sourceElement The element to drag.
     * @param {(!webdriver.WebElement|{x: number, y: number})} targetElementOrLocation The
     *     location to drag to, either as another WebElement or an offset in pixels.
     * @return {!webdriver.ActionSequence} A self reference.
     */
    dragAndDrop = function (sourceElement, targetElementOrLocation) {
        // get absolute source location
        const performDragAndDrop = () => sourceElement.getLocation().then(roundPoint).then(sourceLocation => {
            // get absolute target location
            return findLocationFromElementOrRelativeLocation(targetElementOrLocation, sourceElement)
            .then(roundPoint).then(targetLocation => {
                // move mouse onto source element
                return webdriver.actions().mouseMove(sourceLocation).perform()
                .then(wait)

                // mouse down on source element
                .then(() => webdriver.actions().mouseDown(sourceElement).perform())
                .then(wait)

                // simulate event dragstart on source element
                .then(() => {
                    function dragstartIfDraggable(_element) {
                        var syntheticDragStartEvent = new Event('dragstart', {bubbles: true});

                        syntheticDragStartEvent.pageX = _element.offsetLeft;
                        syntheticDragStartEvent.pageY = _element.offsetTop;

                        if (_element.draggable) {
                            _element.dispatchEvent(syntheticDragStartEvent);
                        }
                        return _element.draggable;
                    }

                    return webdriver.executeScript(dragstartIfDraggable, sourceElement).then(draggable => {
                        if (!draggable) {
                            return Promise.reject(new Error('trying to drag non-draggable element'));
                        }
                    });
                })
                .then(wait)

                // simulate event drag on source element
                .then(() => {
                    function drag(_element, _location) {
                        var syntheticDragEvent = new Event('drag', {bubbles: true});

                        syntheticDragEvent.pageX = _location.x;
                        syntheticDragEvent.pageY = _location.y;
                        _element.dispatchEvent(syntheticDragEvent);
                    }

                    return webdriver.executeScript(drag, sourceElement, sourceLocation);
                })
                .then(wait)

                // move mouse to target location
                .then(() => webdriver.actions().mouseMove(targetLocation).perform())
                .then(wait)

                // simulate event dragover on (current) target element
                .then(() => findElementFromElementOrAbsoluteLocation(targetLocation))
                .then(targetElement => {
                    function dragoverAndCheckIfValidDropTarget(_element, _location) {
                        var syntheticDragoverEvent = new Event('dragover', {bubbles: true});
                        var ableToDrop = false;

                        // yes baby, we need to stub this, since `syntheticDragoverEvent.defaultPrevented` will be false!
                        var oldPreventDefault = syntheticDragoverEvent.preventDefault;
                        syntheticDragoverEvent.preventDefault = function () {
                            ableToDrop = true;
                            oldPreventDefault.call(this);
                        };
                        syntheticDragoverEvent.pageX = _location.x;
                        syntheticDragoverEvent.pageY = _location.y;
                        _element.dispatchEvent(syntheticDragoverEvent);

                        return ableToDrop;
                    }

                    return webdriver.executeScript(dragoverAndCheckIfValidDropTarget, targetElement, targetLocation)
                    .then(ableToDrop => {
                        if (!ableToDrop) {
                            return Promise.reject(new Error('trying to drop on invalid drop target'));
                        }
                    });
                })
                .then(wait)

                // simulate event drop on (current) target element
                .then(() => findElementFromElementOrAbsoluteLocation(targetLocation))
                .then(targetElement => {
                    function drop(_targetElement, _targetLocation) {
                        var syntheticDropEvent = new Event('drop', {bubbles: true});
                        syntheticDropEvent.pageX = _targetLocation.x;
                        syntheticDropEvent.pageY = _targetLocation.y;
                        _targetElement.dispatchEvent(syntheticDropEvent);
                    }

                    return webdriver.executeScript(drop, targetElement, targetLocation);
                })
                .then(wait)

                // simulate event dragend on source element
                .then(() => {
                    function dragend(_sourceElement) {
                        _sourceElement.dispatchEvent(new Event('dragend', {bubbles: true}));
                    }

                    return webdriver.executeScript(dragend, sourceElement)
                        .catch(recoverFromStaleElementReferenceError);
                })
                .then(wait)

                // mouse up on (current) target element
                .then(() => findElementFromElementOrAbsoluteLocation(targetLocation))
                .then(targetElement => {
                    return webdriver.actions().mouseUp(targetElement).perform()
                        .catch(recoverFromStaleElementReferenceError);
                })
                .then(wait);
            });
        });

        var actions = this.actions_;

        actions.push({
            isMonkeyPatchedDragAndDrop: true,
            performDragAndDrop: performDragAndDrop
        });

        this.perform = function () {
            return webdriver.controlFlow().execute(function () {
                actions.forEach(function (action) {
                    if (action.isMonkeyPatchedDragAndDrop) {
                        action.performDragAndDrop.call(this);
                    } else {
                        webdriver.schedule(action.command, action.description);
                    }
                });
            }, 'ActionSequence.perform');
        };

        return this;
    };
};
