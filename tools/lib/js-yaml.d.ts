// @types/js-yaml lags js-yaml 4.3, which added a nesting limit and the option
// to raise it. See lib/points.ts for why raising it is necessary.
import 'js-yaml';

declare module 'js-yaml' {
  interface LoadOptions {
    maxDepth?: number;
  }
}
