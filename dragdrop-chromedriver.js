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
        var targetElement; // will always hold the actual DOM element (see `findTargetElement`)

        var performDragAndDrop = function () {
            return webdriver.actions().mouseMove(element).perform()
            .then(wait)

            .then(function () {
                return webdriver.actions().mouseDown(element).perform();
            })
            .then(wait)

            .then(function () {
                return webdriver.executeScript(function dragstartIfDraggable(_element) {
                    if (_element.draggable) {
                        _element.dispatchEvent(new Event('dragstart', {bubbles: true}));
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
            .then(function findTargetElement() {
                return webdriver.executeScript(function (_from, _to) {
                    return _to.nodeType
                        ? _to
                        : document.elementFromPoint(
                        _from.offsetLeft + _from.offsetWidth + _to.x,
                        _from.offsetTop + _from.offsetHeight + _to.y
                    );
                }, element, location)
                .then(function (_targetElement) {
                    targetElement = _targetElement;
                });
            })
            .then(function () {
                return webdriver.executeScript(function dragoverAndCheckIfValidDropTarget(_targetElement) {
                    var ableToDrop = false,
                        syntheticDragoverEvent = new Event('dragover', {bubbles: true});

                    // yes baby, we need to stub this, since `syntheticDragoverEvent.defaultPrevented` will be false!
                    var oldPreventDefault = syntheticDragoverEvent.preventDefault;
                    syntheticDragoverEvent.preventDefault = function () {
                        ableToDrop = true;
                        oldPreventDefault.call(this);
                    };
                    _targetElement.dispatchEvent(syntheticDragoverEvent);

                    return ableToDrop;
                }, targetElement)
                .then(function (ableToDrop) {
                    if (!ableToDrop) {
                        throw new Error('trying to drop on invalid drop target');
                    }
                });
            })
            .then(wait)

            .then(function () {
                return webdriver.executeScript(function (_targetElement) {
                    _targetElement.dispatchEvent(new Event('drop', {bubbles: true}));
                }, targetElement);
            })
            .then(function () {
                return webdriver.executeScript(function (_targetElement) {
                    _targetElement.dispatchEvent(new Event('dragend', {bubbles: true}));
                }, targetElement);
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
