import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './hooks/useAuth';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster position="top-right" toastOptions={{ duration: 4000, style: { borderRadius: '8px', background: '#1a1f36', color: '#fff', fontSize: '14px' } }} />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
