// @flow
// Adopted and modified solution from Bohdan Didukh (2017)
// https://stackoverflow.com/questions/41594997/ios-10-safari-prevent-scrolling-behind-a-fixed-overlay-and-maintain-scroll-posi

export interface BodyScrollOptions {
  reserveScrollBarGap?: boolean;
  allowTouchMove?: (el: any) => boolean;
  allowOverscroll?: boolean;
}

interface Lock {
  targetElement: any;
  options: BodyScrollOptions;
}

// Older browsers don't support event options, feature detect it.
let hasPassiveEvents = false;
if (typeof window !== 'undefined') {
  const passiveTestOptions = {
    get passive() {
      hasPassiveEvents = true;
      return undefined;
    },
  };
  window.addEventListener('testPassive', null, passiveTestOptions);
  window.removeEventListener('testPassive', null, passiveTestOptions);
}

const isIosDevice =
  typeof window !== 'undefined' &&
  window.navigator &&
  window.navigator.platform &&
  /iP(ad|hone|od)/.test(window.navigator.platform);
type HandleScrollEvent = TouchEvent;

let locks: Array<Lock> = [];
let documentListenerAdded: boolean = false;
let initialClientY: number = -1;
let previousBodyOverflowSetting;
let previousBodyPaddingRight;

// returns true if `el` should be allowed to receive touchmove events
const allowTouchMove = (el: EventTarget): boolean =>
  locks.some(lock => {
    if (lock.options.allowOverscroll || (lock.options.allowTouchMove && lock.options.allowTouchMove(el))) {
      return true;
    }

    return false;
  });

// returns true if `el` is configured to allow overscroll behaviour
const allowOverscroll = (el: EventTarget): boolean =>
  locks.some(lock => lock.targetElement === el && lock.options.allowOverscroll);

const preventDefault = (rawEvent: HandleScrollEvent): boolean => {
  const e = rawEvent || window.event;

  // For the case whereby consumers adds a touchmove event listener to document.
  // Recall that we do document.addEventListener('touchmove', preventDefault, { passive: false })
  // in disableBodyScroll - so if we provide this opportunity to allowTouchMove, then
  // the touchmove event on document will break.
  if (allowTouchMove(e.target)) {
    return true;
  }

  // Do not prevent if the event has more than one touch (usually meaning this is a multi touch gesture like pinch to zoom)
  if (e.touches.length > 1) return true;

  if (e.preventDefault) e.preventDefault();

  return false;
};

const setOverflowHidden = (options?: BodyScrollOptions) => {
  // Setting overflow on body/documentElement synchronously in Desktop Safari slows down
  // the responsiveness for some reason. Setting within a setTimeout fixes this.
  setTimeout(() => {
    // If previousBodyPaddingRight is already set, don't set it again.
    if (previousBodyPaddingRight === undefined) {
      const reserveScrollBarGap = !!options && options.reserveScrollBarGap === true;
      const scrollBarGap = window.innerWidth - document.documentElement.clientWidth;

      if (reserveScrollBarGap && scrollBarGap > 0) {
        previousBodyPaddingRight = document.body.style.paddingRight;
        document.body.style.paddingRight = `${scrollBarGap}px`;
      }
    }

    // If previousBodyOverflowSetting is already set, don't set it again.
    if (previousBodyOverflowSetting === undefined) {
      previousBodyOverflowSetting = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  });
};

const restoreOverflowSetting = () => {
  // Setting overflow on body/documentElement synchronously in Desktop Safari slows down
  // the responsiveness for some reason. Setting within a setTimeout fixes this.
  setTimeout(() => {
    if (previousBodyPaddingRight !== undefined) {
      document.body.style.paddingRight = previousBodyPaddingRight;

      // Restore previousBodyPaddingRight to undefined so setOverflowHidden knows it
      // can be set again.
      previousBodyPaddingRight = undefined;
    }

    if (previousBodyOverflowSetting !== undefined) {
      document.body.style.overflow = previousBodyOverflowSetting;

      // Restore previousBodyOverflowSetting to undefined
      // so setOverflowHidden knows it can be set again.
      previousBodyOverflowSetting = undefined;
    }
  });
};

// https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight#Problems_and_solutions
const isTargetElementTotallyScrolled = (targetElement: any): boolean => {
  if (!targetElement) {
    return false;
  }
  let innerHeight = targetElement.clientHeight;
  const computedStyle = window.getComputedStyle(targetElement);

  innerHeight -= parseFloat(computedStyle.paddingTop) + parseFloat(computedStyle.paddingBottom);
  return targetElement.scrollHeight - targetElement.scrollTop <= innerHeight;
};

const handleStartScroll = (event: HandleScrollEvent, targetElement: any): boolean => {
  initialClientY = event.targetTouches[0].clientY;

  if (!allowOverscroll(targetElement)) {
    return false;
  }

  // If we're at the top or the bottom of the container’s scroll, push up or down one pixel.
  // This prevents the scroll from “passing through” to the body.
  if (targetElement && targetElement.scrollTop === 0) {
    // element is at the top of its scroll
    targetElement.scrollTop = 1;
    return false;
  }

  if (isTargetElementTotallyScrolled(targetElement)) {
    // element is at the bottom of its scroll
    targetElement.scrollTop -= 1;
    return false;
  }

  return true;
};

const handleScroll = (event: HandleScrollEvent, targetElement: any): boolean => {
  const clientY = event.targetTouches[0].clientY - initialClientY;

  if (allowTouchMove(event.target)) {
    return false;
  }

  if (targetElement && targetElement.scrollTop === 0 && clientY > 0) {
    // element is at the top of its scroll
    return preventDefault(event);
  }

  if (isTargetElementTotallyScrolled(targetElement) && clientY < 0) {
    // element is at the top of its scroll
    return preventDefault(event);
  }

  event.stopPropagation();
  return true;
};

export const disableBodyScroll = (targetElement: any, options?: BodyScrollOptions): void => {
  if (isIosDevice) {
    // targetElement must be provided, and disableBodyScroll must not have been
    // called on this targetElement before.
    if (!targetElement) {
      // eslint-disable-next-line no-console
      console.error(
        'disableBodyScroll unsuccessful - targetElement must be provided when calling disableBodyScroll on IOS devices.'
      );
      return;
    }

    if (targetElement && !locks.some(lock => lock.targetElement === targetElement)) {
      const lock = {
        targetElement,
        options: options || {},
      };

      locks = [...locks, lock];

      targetElement.ontouchstart = (event: HandleScrollEvent) => {
        if (event.targetTouches.length === 1) {
          // detect single touch
          handleStartScroll(event, targetElement);
        }
      };
      targetElement.ontouchmove = (event: HandleScrollEvent) => {
        if (event.targetTouches.length === 1) {
          // detect single touch
          handleScroll(event, targetElement);
        }
      };

      if (!documentListenerAdded) {
        document.addEventListener('touchmove', preventDefault, hasPassiveEvents ? { passive: false } : undefined);
        documentListenerAdded = true;
      }
    }
  } else {
    setOverflowHidden(options);
    const lock = {
      targetElement,
      options: options || {},
    };

    locks = [...locks, lock];
  }
};

export const clearAllBodyScrollLocks = (): void => {
  if (isIosDevice) {
    // Clear all locks ontouchstart/ontouchmove handlers, and the references
    locks.forEach((lock: Lock) => {
      lock.targetElement.ontouchstart = null;
      lock.targetElement.ontouchmove = null;
    });

    if (documentListenerAdded) {
      document.removeEventListener('touchmove', preventDefault, hasPassiveEvents ? { passive: false } : undefined);
      documentListenerAdded = false;
    }

    locks = [];

    // Reset initial clientY
    initialClientY = -1;
  } else {
    restoreOverflowSetting();
    locks = [];
  }
};

export const enableBodyScroll = (targetElement: any): void => {
  if (isIosDevice) {
    if (!targetElement) {
      // eslint-disable-next-line no-console
      console.error(
        'enableBodyScroll unsuccessful - targetElement must be provided when calling enableBodyScroll on IOS devices.'
      );
      return;
    }

    targetElement.ontouchstart = null;
    targetElement.ontouchmove = null;

    locks = locks.filter(lock => lock.targetElement !== targetElement);

    if (documentListenerAdded && locks.length === 0) {
      document.removeEventListener('touchmove', preventDefault, hasPassiveEvents ? { passive: false } : undefined);

      documentListenerAdded = false;
    }
  } else if (locks.length === 1 && locks[0].targetElement === targetElement) {
    restoreOverflowSetting();

    locks = [];
  } else {
    locks = locks.filter(lock => lock.targetElement !== targetElement);
  }
};
