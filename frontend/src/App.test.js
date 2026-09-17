import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the vaccine supply chain login screen', () => {
  render(<App />);
  expect(screen.getByText(/Blockchain-Enabled Vaccine Supply Chain Management System/i)).toBeInTheDocument();
});
