import { Component, type ReactNode } from "react";

import { ErrorState } from "@/components/ui/state-views";

type QueryBoundaryProps = {
  children: ReactNode;
  title?: string;
  body?: string;
};

type QueryBoundaryState = {
  hasError: boolean;
  resetKey: number;
};

/**
 * Catches errors thrown by Convex `useQuery` during render and shows a
 * recoverable error state instead of crashing the screen.
 */
export class QueryBoundary extends Component<
  QueryBoundaryProps,
  QueryBoundaryState
> {
  state: QueryBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<QueryBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (__DEV__) {
      console.error("[QueryBoundary]", error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          title={this.props.title}
          body={this.props.body}
          onAction={() =>
            this.setState((state) => ({
              hasError: false,
              resetKey: state.resetKey + 1,
            }))
          }
        />
      );
    }

    return (
      <ResetScope key={this.state.resetKey}>{this.props.children}</ResetScope>
    );
  }
}

function ResetScope({ children }: { children: ReactNode }) {
  return children;
}
