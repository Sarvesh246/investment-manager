import { createHashRouter, isRouteErrorResponse, RouterProvider, useRouteError } from 'react-router-dom';
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
