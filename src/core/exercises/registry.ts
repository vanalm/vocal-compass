import { Exercise } from "./Exercise";
import { DirectEcho, MissingNote, RouteReplay, SilentMap, TonalNorth } from "./modules";

/**
 * Adding a training module = subclass Exercise + one register() call here.
 * The Lab UI, Today recommender, and KPI filters all read from this registry.
 */
class ExerciseRegistry {
  private readonly byId = new Map<string, Exercise>();

  register(exercise: Exercise): this {
    if (this.byId.has(exercise.id)) {
      throw new Error(`Exercise id "${exercise.id}" is already registered.`);
    }
    this.byId.set(exercise.id, exercise);
    return this;
  }

  get(id: string): Exercise {
    const exercise = this.byId.get(id);
    if (!exercise) throw new Error(`Unknown exercise "${id}".`);
    return exercise;
  }

  all(): Exercise[] {
    return [...this.byId.values()];
  }
}

export const exercises = new ExerciseRegistry()
  .register(new DirectEcho())
  .register(new RouteReplay())
  .register(new SilentMap())
  .register(new TonalNorth())
  .register(new MissingNote());
