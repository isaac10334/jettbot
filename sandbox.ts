import { Effect, Context } from "effect";

// Declaring a tag for the Config service
class Config extends Context.Tag("Config")<Config, {}>() {}

// Declaring a tag for the Logger service
class Logger extends Context.Tag("Logger")<Logger, {}>() {}
