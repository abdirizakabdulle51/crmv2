import type { Id } from "@/convex/_generated/dataModel.d.ts";
import {
  generateRecommendations,
  type Recommendation as SharedRecommendation,
} from "@/lib/recommendations/rules.ts";

export type Recommendation = SharedRecommendation<Id<"companies">>;

export { generateRecommendations };
