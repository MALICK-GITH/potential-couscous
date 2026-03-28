// Mobile Viewport and Responsive Fixes
class MobileViewportFix {
  constructor() {
    this.isMobile = this.detectMobile();
    this.viewportFixed = false;
    
    this.init();
  }

  detectMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);
  }

  init() {
    if (!this.isMobile) return;
    
    console.log('📱 Mobile Viewport Fix Initializing...');
    
    // Fix viewport issues
    this.fixViewport();
    
    // Fix iOS Safari issues
    this.fixIOSSafari();
    
    // Fix Android Chrome issues
    this.fixAndroidChrome();
    
    // Setup orientation change handling
    this.setupOrientationHandling();
    
    // Setup viewport monitoring
    this.setupViewportMonitoring();
    
    // Fix safe areas
    this.fixSafeAreas();
    
    console.log('✅ Mobile Viewport Fix Ready');
  }

  fixViewport() {
    // Ne pas ecraser la meta viewport du HTML : forcer maximum-scale=1 provoquait un rendu
    // mal cadre sur certains iPhone (Safari ancien) et bloquait le zoom accessibilite.
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
      document.head.appendChild(meta);
    }

    this.setViewportHeight();
  }

  setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    
    // Update on resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
      }, 100);
    });
  }

  fixIOSSafari() {
    if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;
    
    // Fix iOS Safari viewport height issues
    const setIOSSafariHeight = () => {
      const height = window.innerHeight;
      document.documentElement.style.setProperty('--ios-height', `${height}px`);
      
      // Update elements that use full height
      const fullHeightElements = document.querySelectorAll('.full-height, .vh-100');
      fullHeightElements.forEach(el => {
        el.style.height = `${height}px`;
      });
    };
    
    // Initial fix
    setIOSSafariHeight();
    
    // Fix on orientation change
    window.addEventListener('orientationchange', () => {
      setTimeout(setIOSSafariHeight, 100);
    });
    
    // Fix on resize
    window.addEventListener('resize', setIOSSafariHeight);
    
    // Fix iOS Safari scrolling
    this.fixIOSSafariScrolling();
    
    // Fix iOS Safari input zoom
    this.fixIOSSafariInputZoom();
    
    // Fix iOS Safari 100vh issue
    this.fixIOSSafari100vh();
  }

  fixIOSSafariScrolling() {
    // Enable smooth scrolling
    document.documentElement.style.setProperty('-webkit-overflow-scrolling', 'touch');
    
    // Fix momentum scrolling
    const scrollableElements = document.querySelectorAll('.scrollable, .overflow-y-auto');
    scrollableElements.forEach(el => {
      el.style.setProperty('-webkit-overflow-scrolling', 'touch');
    });
    
    // Prevent overscroll bounce
    document.body.style.setProperty('overscroll-behavior', 'none');
    document.body.style.setProperty('-webkit-overscroll-behavior', 'none');
  }

  fixIOSSafariInputZoom() {
    // Prevent zoom on input focus
    const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="number"], textarea, select');
    
    inputs.forEach(input => {
      // Set font size to prevent zoom
      input.style.fontSize = '16px';
      
      // Prevent zoom on focus
      input.addEventListener('focus', () => {
        document.documentElement.style.setProperty('font-size', '16px');
      });
      
      input.addEventListener('blur', () => {
        document.documentElement.style.removeProperty('font-size');
      });
    });
  }

  fixIOSSafari100vh() {
    // Fix 100vh issue in iOS Safari
    const fix100vh = () => {
      const height = window.innerHeight;
      const vh = height / 100;
      
      // Update CSS custom properties
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      document.documentElement.style.setProperty('--full-height', `${height}px`);
      
      // Update elements with vh units
      const vhElements = document.querySelectorAll('[style*="vh"]');
      vhElements.forEach(el => {
        const style = el.getAttribute('style');
        const newStyle = style.replace(/(\d+(?:\.\d+)?)vh/g, (match, p1) => {
          return `${parseFloat(p1) * vh}px`;
        });
        el.setAttribute('style', newStyle);
      });
    };
    
    // Initial fix
    fix100vh();
    
    // Fix on resize and orientation change
    window.addEventListener('resize', () => {
      setTimeout(fix100vh, 100);
    });
    
    window.addEventListener('orientationchange', () => {
      setTimeout(fix100vh, 100);
    });
  }

  fixAndroidChrome() {
    if (!/Android/i.test(navigator.userAgent)) return;
    
    // Fix Android Chrome viewport
    document.body.style.setProperty('overflow-x', 'hidden');
    
    // Fix Android Chrome input styling
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.style.setProperty('-webkit-appearance', 'none');
      input.style.setProperty('appearance', 'none');
      input.style.setProperty('border-radius', '8px');
    });
    
    // Fix Android Chrome button styling
    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]');
    buttons.forEach(button => {
      button.style.setProperty('-webkit-appearance', 'none');
      button.style.setProperty('appearance', 'none');
      button.style.setProperty('border-radius', '8px');
    });
    
    // Fix Android Chrome scrolling
    this.fixAndroidChromeScrolling();
  }

  fixAndroidChromeScrolling() {
    // Enable smooth scrolling
    document.documentElement.style.setProperty('scroll-behavior', 'smooth');
    
    // Fix momentum scrolling
    const scrollableElements = document.querySelectorAll('.scrollable, .overflow-y-auto');
    scrollableElements.forEach(el => {
      el.style.setProperty('-webkit-overflow-scrolling', 'touch');
    });
  }

  setupOrientationHandling() {
    // Handle orientation changes
    let orientationTimeout;
    
    const handleOrientationChange = () => {
      clearTimeout(orientationTimeout);
      orientationTimeout = setTimeout(() => {
        // Update viewport height
        this.setViewportHeight();
        
        // Update orientation-specific styles
        const isLandscape = window.innerWidth > window.innerHeight;
        
        if (isLandscape) {
          document.body.classList.add('landscape');
          document.body.classList.remove('portrait');
        } else {
          document.body.classList.add('portrait');
          document.body.classList.remove('landscape');
        }
        
        console.log(`📱 Orientation changed to: ${isLandscape ? 'landscape' : 'portrait'}`);
      }, 300);
    };
    
    // Listen for orientation change
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);
    
    // Initial orientation setup
    handleOrientationChange();
  }

  setupViewportMonitoring() {
    // Monitor viewport changes
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    
    const monitorViewport = () => {
      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      
      if (currentWidth !== lastWidth || currentHeight !== lastHeight) {
        // Update viewport variables
        lastWidth = currentWidth;
        lastHeight = currentHeight;
        
        // Update CSS custom properties
        document.documentElement.style.setProperty('--viewport-width', `${currentWidth}px`);
        document.documentElement.style.setProperty('--viewport-height', `${currentHeight}px`);
        
        // Update viewport classes
        document.body.classList.remove('viewport-small', 'viewport-medium', 'viewport-large');
        
        if (currentWidth <= 360) {
          document.body.classList.add('viewport-small');
        } else if (currentWidth <= 768) {
          document.body.classList.add('viewport-medium');
        } else {
          document.body.classList.add('viewport-large');
        }
        
        // Dispatch viewport change event
        document.dispatchEvent(new CustomEvent('viewportchange', {
          detail: {
            width: currentWidth,
            height: currentHeight,
            orientation: currentWidth > currentHeight ? 'landscape' : 'portrait'
          }
        }));
      }
    };
    
    // Monitor on resize
    window.addEventListener('resize', () => {
      clearTimeout(this.viewportMonitorTimeout);
      this.viewportMonitorTimeout = setTimeout(monitorViewport, 100);
    });
    
    // Initial monitoring
    monitorViewport();
  }

  fixSafeAreas() {
    // Add safe area CSS custom properties
    const computedStyle = getComputedStyle(document.documentElement);
    
    // Set safe area variables
    document.documentElement.style.setProperty('--safe-area-inset-top', 
      computedStyle.getPropertyValue('env(safe-area-inset-top)') || '0px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', 
      computedStyle.getPropertyValue('env(safe-area-inset-bottom)') || '0px');
    document.documentElement.style.setProperty('--safe-area-inset-left', 
      computedStyle.getPropertyValue('env(safe-area-inset-left)') || '0px');
    document.documentElement.style.setProperty('--safe-area-inset-right', 
      computedStyle.getPropertyValue('env(safe-area-inset-right)') || '0px');
    
    // Update safe areas on resize
    window.addEventListener('resize', () => {
      setTimeout(() => {
        const style = getComputedStyle(document.documentElement);
        document.documentElement.style.setProperty('--safe-area-inset-top', 
          style.getPropertyValue('env(safe-area-inset-top)') || '0px');
        document.documentElement.style.setProperty('--safe-area-inset-bottom', 
          style.getPropertyValue('env(safe-area-inset-bottom)') || '0px');
        document.documentElement.style.setProperty('--safe-area-inset-left', 
          style.getPropertyValue('env(safe-area-inset-left)') || '0px');
        document.documentElement.style.setProperty('--safe-area-inset-right', 
          style.getPropertyValue('env(safe-area-inset-right)') || '0px');
      }, 100);
    });
  }

  // Public API methods
  getViewportInfo() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
      isMobile: this.isMobile,
      safeArea: {
        top: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'),
        bottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom'),
        left: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-left'),
        right: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-right')
      }
    };
  }

  updateViewport(options = {}) {
    const {
      width = 'device-width',
      height = 'device-height',
      initialScale = 1.0,
      maximumScale = 1.0,
      userScalable = 'no',
      viewportFit = 'cover'
    } = options;
    
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      const content = `width=${width}, height=${height}, initial-scale=${initialScale}, maximum-scale=${maximumScale}, user-scalable=${userScalable}, viewport-fit=${viewportFit}`;
      viewport.setAttribute('content', content);
    }
  }

  enableUserZoom() {
    this.updateViewport({
      maximumScale: 5.0,
      userScalable: 'yes'
    });
  }

  disableUserZoom() {
    this.updateViewport({
      maximumScale: 1.0,
      userScalable: 'no'
    });
  }
}

// Initialize mobile viewport fix
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.mobileViewportFix = new MobileViewportFix();
    });
  } else {
    window.mobileViewportFix = new MobileViewportFix();
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileViewportFix;
}
