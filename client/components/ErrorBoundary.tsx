import React, { Component, ComponentType, PropsWithChildren } from "react";
import { ErrorFallback, ErrorFallbackProps } from "@/components/ErrorFallback";

export type ErrorBoundaryProps = PropsWithChildren<{
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  onError?: (
    error: Error,
    stackTrace: string,
  ) => string | null | void | Promise<string | null | void>;
}>;

type ErrorBoundaryState = {
  error: Error | null;
  errorReference: string | null;
};

/**
 * This is a special case for for using the class components. Error boundaries must be class components because React only provides error boundary functionality through lifecycle methods (componentDidCatch and getDerivedStateFromError) which are not available in functional components.
 * https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
 */

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, errorReference: null };

  static defaultProps: {
    FallbackComponent: ComponentType<ErrorFallbackProps>;
  } = {
    FallbackComponent: ErrorFallback,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, errorReference: null };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    const reportResult = this.props.onError?.(error, info.componentStack);
    if (typeof reportResult === "string") {
      this.setState({ errorReference: reportResult });
    } else if (
      reportResult &&
      typeof (reportResult as PromiseLike<unknown>).then === "function"
    ) {
      void Promise.resolve(reportResult)
        .then((reference) => {
          if (typeof reference === "string" && reference) {
            this.setState({ errorReference: reference });
          }
        })
        .catch(() => {
          // Error reporting must never replace the production fallback.
        });
    }
  }

  resetError = (): void => {
    this.setState({ error: null, errorReference: null });
  };

  render() {
    const { FallbackComponent } = this.props;

    return this.state.error && FallbackComponent ? (
      <FallbackComponent
        error={this.state.error}
        resetError={this.resetError}
        errorReference={this.state.errorReference}
      />
    ) : (
      this.props.children
    );
  }
}
