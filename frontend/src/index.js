import "leaflet/dist/leaflet.css";
import 'bootstrap/dist/css/bootstrap.min.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './design-system.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
// React 19 development StrictMode replays Leaflet's MapContainer ref on the
// same DOM node. The installed React-Leaflet v4 adapter initializes Leaflet
// twice in that replay, causing "Map container is already initialized".
root.render(<App />);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
