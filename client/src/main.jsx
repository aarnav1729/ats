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
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: '24px',
              background: 'rgba(255, 253, 249, 0.94)',
              color: '#171a20',
              fontSize: '14px',
              border: '1px solid rgba(29, 33, 41, 0.08)',
              boxShadow: '0 30px 70px -42px rgba(18, 19, 24, 0.32)',
              backdropFilter: 'blur(18px)',
            },
            success: {
              iconTheme: {
                primary: '#2f6a51',
                secondary: '#f8fbf8',
              },
            },
            error: {
              iconTheme: {
                primary: '#d75434',
                secondary: '#fff8f6',
              },
            },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
