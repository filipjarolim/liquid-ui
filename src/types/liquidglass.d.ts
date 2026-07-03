import React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'glass-container': any;
      'glass-panel': any;
      'glass-button': any;
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'glass-container': any;
      'glass-panel': any;
      'glass-button': any;
    }
  }
}
