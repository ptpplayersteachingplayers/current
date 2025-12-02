import { QueryClient } from '@tanstack/react-query';

// Centralized QueryClient so we can share it between providers and logout logic.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fail fast in mobile environments; individual hooks override as needed.
      staleTime: 60 * 1000,
      refetchOnWindowFocus: true,
    },
  },
});

export default queryClient;
