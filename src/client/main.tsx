import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home.tsx';
import { Room } from './Room.tsx';
import './styles.css';

function App() {
  const [path, setPath] = useState(location.pathname);

  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const go = (to: string) => {
    history.pushState(null, '', to);
    setPath(to);
  };

  const room = /^\/g\/([a-z0-9]{4,16})\/?$/.exec(path);
  if (room) return <Room key={room[1]} id={room[1]} go={go} />;
  return <Home go={go} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
