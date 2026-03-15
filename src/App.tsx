import { createHashRouter, isRouteErrorResponse, Navigate, RouterProvider, useRouteError } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  AlertsPage,
  AppShell,
  DashboardPage,
  DiscoveryPage,
  JournalPage,
  PlannerPage,
  PortfolioPage,
  RecommendationsPage,
  SettingsPage,
  StockPage,
} from './pages';
import { PortfolioWorkspaceProvider } from './runtime/portfolioWorkspace';
import { ToastProvider } from './runtime/toastContext';

function RouterErrorPage() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.name
      : 'Something went wrong';
  const detail = isRouteErrorResponse(error)
    ? 'The page could not be loaded. Use the sidebar to return to a valid screen.'
    : error instanceof Error
      ? error.message
      : 'Try refreshing the page. If the issue persists, return to Home and retry.';

  return (
    <div className="route-error">
      <div className="route-error__eyebrow">Navigation issue</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      <a href="#/" className="action-button">
        Return Home
      </a>
    </div>
  );
}

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouterErrorPage />,
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
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: 'journal',
        element: <JournalPage />,
      },
      {
        path: 'stocks/:symbol',
        element: <StockPage />,
      },
      {
        path: 'main-content',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <PortfolioWorkspaceProvider>
          <RouterProvider router={router} />
        </PortfolioWorkspaceProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
