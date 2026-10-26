import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { AlbumPage } from './pages/AlbumPage.tsx';
import { ArtistPage } from './pages/ArtistPage.tsx';
import { ArtistsPage } from './pages/ArtistsPage.tsx';
import { LedgerPage } from './pages/LedgerPage.tsx';
import { LibraryPage } from './pages/LibraryPage.tsx';
import { NotFoundPage, RouteError } from './pages/NotFoundPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { TracksPage } from './pages/TracksPage.tsx';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: 'albums/:id', element: <AlbumPage /> },
      { path: 'artists', element: <ArtistsPage /> },
      { path: 'artists/:id', element: <ArtistPage /> },
      { path: 'tracks', element: <TracksPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'ledger', element: <LedgerPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
