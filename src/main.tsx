import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import CaptureEditor from './CaptureEditor';
import QuickTranslate from './QuickTranslate';
import './styles.css';

function Root() {
  const route = new URLSearchParams(window.location.search);
  if (route.has('quick-translate')) {
    return <QuickTranslate />;
  }
  if (route.has('overlay')) {
    return <CaptureEditor mode={route.get('overlay') || 'region'} />;
  }
  if (route.has('pin')) {
    return <CaptureEditor mode="pin" />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
