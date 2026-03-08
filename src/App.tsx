import { createHashRouter, RouterProvider } from 'react-router-dom';
import {
  AlertsPage,
  AppShell,
  DashboardPage,
  DiscoveryPage,
  JournalPage,
  PlannerPage,
  PortfolioPage,
  RecommendationsPage,
  StockPage,
} from './pages';
import { PortfolioWorkspaceProvider } from './runtime/portfolioWorkspace';

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'discovery',
        element: <DiscoveryPage />,
      },
      {
        path: 'portfolio',
        element: <PortfolioPage />,
      },
      {
        path: 'recommendations',
        element: <RecommendationsPage />,
      },
      {
        path: 'planner',
        element: <PlannerPage />,
      },
      {
        path: 'alerts',
        element: <AlertsPage />,
      },
      {
        path: 'journal',
        element: <JournalPage />,
      },
      {
        path: 'stocks/:symbol',
        element: <StockPage />,
      },
    ],
  },
]);

export default function App() {
  return (
    <PortfolioWorkspaceProvider>
      <RouterProvider router={router} />
    </PortfolioWorkspaceProvider>
  );
}
