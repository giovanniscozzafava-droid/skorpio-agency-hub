import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import { ResetPassword } from './pages/ResetPassword';
import GCalCallback from './pages/GCalCallback';
import GDriveCallback from './pages/GDriveCallback';
import TvPlayer from './pages/TvPlayer';
import CanvaCallback from './pages/CanvaCallback';
import NotFound from './pages/NotFound';

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/tv/:slug" element={<TvPlayer />} />
      <Route path="/canva-callback" element={<CanvaCallback />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/gcal-callback" element={<GCalCallback />} />
      <Route path="/gdrive-callback" element={<GDriveCallback />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
