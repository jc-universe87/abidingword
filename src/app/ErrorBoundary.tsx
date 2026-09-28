import { Component, type ErrorInfo, type ReactNode } from "react";
import { StartupScreen } from "./StartupScreen";

interface Props {
  onError: (message: string) => void;
  children: ReactNode;
}

/** Catches rendering failures: the user sees a plain message, the log gets detail. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(`${error.name}: ${error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (this.state.failed) {
      return (
        <StartupScreen message="Something unexpected went wrong in the window. Please close Abiding Word and open it again. Your saved work is safe." />
      );
    }
    return this.props.children;
  }
}
