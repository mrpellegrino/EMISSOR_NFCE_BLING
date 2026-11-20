import { Accounts } from './components/Accounts/Accounts';
import { useState, useEffect } from 'react';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import { Settings } from './components/Settings';
import { PedidosVenda } from './components/PedidosVenda';
import { FilaRPS } from './components/FilaRPS';
import { CrmLeads } from './components/OfficeModules/CrmLeads';
import { PaidTraffic } from './components/OfficeModules/PaidTraffic';
import { McpHub } from './components/OfficeModules/McpHub';
import { authApi } from './services/authApi';

type AppView =
  | 'login'
  | 'register'
  | 'dashboard'
  | 'settings'
  | 'pedidos-venda'
  | 'fila-rps'
  | 'crm'
  | 'ads'
  | 'mcp';

interface User {
  id: string;
  name: string;
  email: string;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('login');

  useEffect(() => {
    // Verifica se já existe um usuário logado
    const checkAuth = async () => {
      if (authApi.isAuthenticated()) {
        const isValid = await authApi.validateToken();
        if (isValid) {
          setUser(authApi.getUser());

          // Verifica se está na rota de settings (callback OAuth)
          const path = window.location.pathname;
          if (path === '/settings' || window.location.search.includes('bling=')) {
            setCurrentView('settings');
          } else if (path === '/fila-rps') {
            setCurrentView('fila-rps');
          } else if (path === '/pedidos-venda') {
            setCurrentView('pedidos-venda');
          } else if (path === '/crm') {
            setCurrentView('crm');
          } else if (path === '/ads') {
            setCurrentView('ads');
          } else if (path === '/mcp') {
            setCurrentView('mcp');
          } else {
            setCurrentView('dashboard');
          }
        } else {
          authApi.logout();
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const handleLoginSuccess = (loggedUser: User) => {
    setUser(loggedUser);
    setCurrentView('dashboard');
  };

  const handleRegisterSuccess = (registeredUser: User) => {
    setUser(registeredUser);
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    authApi.logout();
    setUser(null);
    setCurrentView('login');
  };

  const handleGoToSettings = () => {
    setCurrentView('settings');
    window.history.pushState({}, '', '/settings');
  };

  const handleBackFromSettings = () => {
    setCurrentView('dashboard');
    window.history.pushState({}, '', '/');
  };

  const handleGoToPedidosVenda = () => {
    setCurrentView('pedidos-venda');
    window.history.pushState({}, '', '/pedidos-venda');
  };

  const handleBackFromPedidosVenda = () => {
    setCurrentView('dashboard');
    window.history.pushState({}, '', '/');
  };

  const handleGoToFilaRPS = () => {
    setCurrentView('fila-rps');
    window.history.pushState({}, '', '/fila-rps');
  };

  const handleBackFromFilaRPS = () => {
    setCurrentView('dashboard');
    window.history.pushState({}, '', '/');
  };

  const handleGoToCrm = () => {
    setCurrentView('crm');
    window.history.pushState({}, '', '/crm');
  };

  const handleGoToAds = () => {
    setCurrentView('ads');
    window.history.pushState({}, '', '/ads');
  };

  const handleGoToMcp = () => {
    setCurrentView('mcp');
    window.history.pushState({}, '', '/mcp');
  };

  const handleBackToDashboard = () => {
    setCurrentView('dashboard');
    window.history.pushState({}, '', '/');
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid rgba(255, 255, 255, 0.3)',
          borderTopColor: 'white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (user) {
    const screen = currentView === 'settings' ? <Settings onBack={handleBackFromSettings} />
      : currentView === 'pedidos-venda' ? <PedidosVenda onBack={handleBackFromPedidosVenda} />
      : currentView === 'fila-rps' ? <FilaRPS onBack={handleBackFromFilaRPS} />
      : currentView === 'crm' ? <CrmLeads onBack={handleBackToDashboard} />
      : currentView === 'ads' ? <PaidTraffic onBack={handleBackToDashboard} />
      : currentView === 'mcp' ? <McpHub onBack={handleBackToDashboard} />
      : <Dashboard user={user} onLogout={handleLogout} onGoToSettings={handleGoToSettings}
          onGoToPedidosVenda={handleGoToPedidosVenda} onGoToFilaRPS={handleGoToFilaRPS}
          onGoToCrm={handleGoToCrm} onGoToAds={handleGoToAds} onGoToMcp={handleGoToMcp} />;
    return <Accounts key={user.id} userId={user.id} onCreated={handleGoToSettings} onLogout={handleLogout}>{screen}</Accounts>;
  }

  // Rotas não autenticadas
  if (currentView === 'register') {
    return (
      <Register
        onRegisterSuccess={handleRegisterSuccess}
        onBackToLogin={() => setCurrentView('login')}
      />
    );
  }

  return (
    <Login
      onLoginSuccess={handleLoginSuccess}
      onGoToRegister={() => setCurrentView('register')}
    />
  );
}

export default App;
