import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { vi } from 'vitest';
import { routes } from '../routes.tsx';

/** Renders the real app routes at `path`, with fresh query state. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

type Responder = (url: URL, init?: RequestInit) => unknown;

export const LIBRARY_READY = {
  root: '/music',
  source: 'file',
  watching: true,
  state: 'idle',
  progress: null,
  error: null,
};

/**
 * Replaces fetch with a router over `/api/*` paths. Unmatched requests fail
 * the test loudly instead of hanging. Returns the mock to inspect calls.
 */
export function mockApi(given: Record<string, Responder | unknown>) {
  // Every page asks for the library status; by default a folder is chosen.
  const routesByPath: Record<string, Responder | unknown> = { library: LIBRARY_READY, ...given };
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const key = `${init?.method && init.method !== 'GET' ? `${init.method} ` : ''}${url.pathname.replace(/^\/api\//, '')}`;
    if (!(key in routesByPath)) {
      return new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: `No mock for ${key}` } }),
        {
          status: 404,
        },
      );
    }
    const entry = routesByPath[key];
    const body = typeof entry === 'function' ? (entry as Responder)(url, init) : entry;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
