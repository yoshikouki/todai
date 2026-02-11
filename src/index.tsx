#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./cli/app.tsx";

render(<App args={Bun.argv.slice(2)} />);
