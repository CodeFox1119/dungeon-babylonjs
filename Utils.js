class Utils {
    constructor() {
    }
  
    isTouchEnabled() {
      return ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (navigator.msMaxTouchPoints > 0);
    }
  
    /**
     * Transform an angle in degrees to the nearest cardinal point.
     */
    cardinals = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
    degreeToCardinal(degree) {
      const remainder = degree % 360;
      const index = Math.round((remainder < 0 ? degree + 360 : degree) / 45) % 8;
      return this.cardinals[index];
    }

    getWindowWidth() {
        return Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    }
	
    getWindowHeight() {    
	    return Math.max(document.documentElement.clientHeight, window.innerHeight || 0)
    }

    // check if we're running in an iFrame
    isIframe() {
    	return window.location !== window.parent.location;
    }

  
  }
  
  export default new Utils()