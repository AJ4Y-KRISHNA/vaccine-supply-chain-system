import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the vaccine supply chain login screen', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'SmartVax' })).toBeInTheDocument();
  expect(screen.getByText(/Intelligent Vaccine Cold-Chain Monitoring & Supply Management/i)).toBeInTheDocument();
});
