import React from "react";
import { Text } from "ink";

interface AppProps {
  args: string[];
}

export function App({ args }: AppProps) {
  const command = args[0];

  if (!command) {
    return <Text>todai - AIエージェント前提のタスク管理ツール</Text>;
  }

  return <Text>Unknown command: {command}</Text>;
}
