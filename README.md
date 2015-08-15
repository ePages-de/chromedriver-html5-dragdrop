# Chromedriver HTML5 drag and drop fix
![<text>](http://pixel-cookers.github.io/built-with-badges/node/node-short.png)

## Problem statement
If you're using the HTML5 drag and drop implementation in you web app and want to test its behaviour
with Selenium and Chromedriver, you're out of luck due to 
[**this bug**](https://code.google.com/p/chromedriver/issues/detail?id=841):

Chromedriver can handle `clickAndHold`, `move` and `release`, but has a bug in this. There is a `event.button` 
attribute in every Javascript `MouseEvent` object. This is set to `-1` if nothing is clicked
and something between `0` (main mouse button) and `4` if a button is clicked.
Now chromedriver sets this on `clickAndHold` but does not take it over into the move
so when moving the `event.button` is `-1` again.

## Solution
Using [Selenium's JS API](https://github.com/SeleniumHQ/selenium/tree/master/javascript/webdriver), 
possibly wrapped by something like [Nemo](https://github.com/paypal/nemo), 
simply include `dragdrop-chromedriver.js` in your test runner or -suite, like this:

```js
    require('chromedriver-html5-dragdrop')(yourInstantiatedWebdriver/* , waitMillisBetweenSteps */);
```

When using Nemo, `yourInstantiatedWebdriver` is usually `nemo.driver`.

You can set `waitMillisBetweenSteps` for debugging or watching what's happening. 

Now, use `dragAndDrop` just like in Selenium's [example](https://github.com/SeleniumHQ/selenium/blob/master/javascript/webdriver/actionsequence.js#L32).
[Refer here](http://selenium.googlecode.com/git/docs/api/javascript/class_webdriver_ActionSequence.html#dragAndDrop) 
for the `dragAndDrop` method's API.

## Caveats
Because for security reasons synthetic drag events do not have a usable `dataTransfer` property, 
all `dataTransfer` accesses in the tested code must be made conditional, for example like this:

```js
    if (event.dataTransfer) { event.dataTransfer.dropEffect = 'move'; }
```
 
Because of this, but also due to limits of the original `dragAndDrop` API, **you won't be able to test dragging files into the browser window**.

## How it works
Basically it monkey patches `webdriver.ActionSequence`, overriding its `dragAndDrop` function 
with one that remains fully API compatible to [the original one](https://github.com/SeleniumHQ/selenium/blob/master/javascript/webdriver/actionsequence.js#L218), 
but internally triggers the `dragstart`, `drag`, `dragover`, `drop` and `dragend` events in the browser context. 
There are some checks to prevent this approach from performing drag and drop operations a real user wouldn't be able to perform.
