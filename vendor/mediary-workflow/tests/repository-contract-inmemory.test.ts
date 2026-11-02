import { InMemoryWorkflowRepository } from "../src/repository.js";
import { runRepositoryContract } from "./repository-contract.js";

runRepositoryContract("InMemory", { make: () => new InMemoryWorkflowRepository() });
