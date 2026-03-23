import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Index from './pages/Index';
import { ResetPassword } from './pages/ResetPassword';
import NotFound from './pages/NotFound';

const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  </BrowserRouter>
);

export default App;
