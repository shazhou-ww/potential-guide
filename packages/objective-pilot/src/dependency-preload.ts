import { register } from "node:module";

register("./dependency-loader.js", import.meta.url);
