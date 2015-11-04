/* eslint-env node,browser */

module.exports = function (webdriver, waitTime) {
    'use strict';

    var wait = function () {
        return webdriver.sleep(waitTime || 1);
    };

    /* Monkey patch `webdriver.ActionSequence`, overriding its `dragAndDrop` function with a fixed one */
    var dragAndDrop,
        originalActions = webdriver.actions;
    webdriver.actions = function () {
        var actionsInstance = originalActions.call(webdriver);
        actionsInstance.dragAndDrop = dragAndDrop;
        return actionsInstance;
    };

    function recoverFromStaleElementReferenceError (err) {
        // the source element might have been removed, so ignore this error here
        if (err.name !== 'StaleElementReferenceError') {
            throw err;
        }
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
     * @param {!webdriver.WebElement} element The element to drag.
     * @param {(!webdriver.WebElement|{x: number, y: number})} location The
     *     location to drag to, either as another WebElement or an offset in pixels.
     * @return {!webdriver.ActionSequence} A self reference.
     */
    dragAndDrop = function (element, location) {
        var targetElement, // will always hold the actual DOM element (see `findTargetElement`)
            elementLocation = {},
            targetLocation = {};

        var performDragAndDrop = function () {
            return webdriver.actions().mouseMove(element).perform()
                .then(wait)

                .then(function () {
                    return webdriver.actions().mouseDown(element).perform();
                })
                .then(wait)

                .then(function () {
                    return webdriver.executeScript(function dragstartIfDraggable(_element) {
                        var syntheticDragStartEvent = new Event('dragstart', {bubbles: true});

                        syntheticDragStartEvent.pageX = _element.offsetLeft;
                        syntheticDragStartEvent.pageY = _element.offsetTop;

                        if (_element.draggable) {
                            _element.dispatchEvent(syntheticDragStartEvent);
                        }
                        return _element.draggable;
                    }, element)
                        .then(function (draggable) {
                            if (!draggable) {
                                throw new Error('trying to drag non-draggable element');
                            }
                        });
                })
                .then(wait)

                .then(function () {
                    return webdriver.actions().mouseMove(location).perform();
                })
                .then(function () {
                    return element.getLocation();
                })
                .then(function findTargetElement(_elementLocation) {
                    elementLocation = _elementLocation;

                    return webdriver.executeScript(function (_from, _to) {
                        return _to.nodeType ? _to : document.elementFromPoint(_from.x + _to.x, _from.y + _to.y);
                    }, elementLocation, location)
                        .then(function (_targetElement) {
                            targetElement = _targetElement;
                        });
                })
                .then(function findTargetLocation() {
                    // dragAndDrop by an offset
                    if (typeof location.x === 'number') {
                        targetLocation.x = elementLocation.x + location.x;
                        targetLocation.y = elementLocation.y + location.y;

                        // return a Promise that resolves with nothing
                        return webdriver.actions().mouseMove(location).perform();
                    }

                    // dragAndDrop onto another element
                    return location.getLocation().then(function (_targetLocation) {
                        targetLocation = _targetLocation;
                    });
                })
                .then(function () {
                    return webdriver.executeScript(function (_element, _targetLocation) {
                        var syntheticDragEvent = new Event('drag', {bubbles: true});

                        syntheticDragEvent.pageX = _targetLocation.x;
                        syntheticDragEvent.pageY = _targetLocation.y;
                        _element.dispatchEvent(syntheticDragEvent);
                    }, element, targetLocation);
                })
                .then(function () {
                    return webdriver.executeScript(function dragoverAndCheckIfValidDropTarget(_targetElement, _targetLocation) {
                        var ableToDrop = false,
                            syntheticDragoverEvent = new Event('dragover', {bubbles: true});

                        // yes baby, we need to stub this, since `syntheticDragoverEvent.defaultPrevented` will be false!
                        var oldPreventDefault = syntheticDragoverEvent.preventDefault;
                        syntheticDragoverEvent.preventDefault = function () {
                            ableToDrop = true;
                            oldPreventDefault.call(this);
                        };
                        syntheticDragoverEvent.pageX = _targetLocation.x;
                        syntheticDragoverEvent.pageY = _targetLocation.y;
                        _targetElement.dispatchEvent(syntheticDragoverEvent);

                        return ableToDrop;
                    }, targetElement, targetLocation)
                        .then(function (ableToDrop) {
                            if (!ableToDrop) {
                                throw new Error('trying to drop on invalid drop target');
                            }
                        });
                })
                .then(wait)

                .then(function () {
                    return webdriver.executeScript(function (_targetElement, _targetLocation) {
                        var syntheticDropEvent = new Event('drop', {bubbles: true});
                        syntheticDropEvent.pageX = _targetLocation.x;
                        syntheticDropEvent.pageY = _targetLocation.y;
                        _targetElement.dispatchEvent(syntheticDropEvent);
                    }, targetElement, targetLocation);
                })
                .then(function () {
                    return webdriver.executeScript(function (_sourceElement) {
                        _sourceElement.dispatchEvent(new Event('dragend', {bubbles: true}));
                    }, element)
                        .thenCatch(recoverFromStaleElementReferenceError);
                })
                .then(function () {
                    return webdriver.actions().mouseUp(targetElement).perform()
                        .thenCatch(recoverFromStaleElementReferenceError);
                });
        };

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
