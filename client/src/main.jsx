import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';
import './styles/v2.css';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './hooks/useAuth';

const toastConfig = {
  duration: 3500,
  style: {
    borderRadius: '16px',
    background: '#1e293b',
    color: '#f8fafc',
    fontSize: '14px',
    fontWeight: '500',
    padding: '16px 20px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    maxWidth: '400px',
  },
  success: {
    duration: 3000,
    iconTheme: {
      primary: '#10b981',
      secondary: '#1e293b',
    },
    style: {
      borderLeft: '4px solid #10b981',
    },
  },
  error: {
    duration: 5000,
    iconTheme: {
      primary: '#ef4444',
      secondary: '#1e293b',
    },
    style: {
      borderLeft: '4px solid #ef4444',
    },
  },
  loading: {
    iconTheme: {
      primary: '#3b82f6',
      secondary: '#1e293b',
    },
    style: {
      borderLeft: '4px solid #3b82f6',
    },
  },
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={toastConfig}
          gutter={16}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
