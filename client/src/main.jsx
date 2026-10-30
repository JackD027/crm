import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './state.jsx';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><AuthGate><AppProvider><App /></AppProvider></AuthGate></BrowserRouter></React.StrictMode>);
