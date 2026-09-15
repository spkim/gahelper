import { getRecipe, matchRecipes } from './recipe-store.js';

// v3 §5 — 현재 컨텍스트에서 어떤 Recipe를 실행할지 결정.
// 우선순위: explicit → launch-intent → session → url → generic-setup
// LLM 호출 없음. 결정적(deterministic).
export function resolveRecipe({
  explicitRecipeId,
  launchIntent,
  activeRecipeSession,
  url,
} = {}) {
  if (explicitRecipeId && getRecipe(explicitRecipeId)) {
    return { recipeId: explicitRecipeId, source: 'explicit' };
  }

  if (launchIntent?.recipeId && getRecipe(launchIntent.recipeId)) {
    return { recipeId: launchIntent.recipeId, source: 'launch-intent' };
  }

  if (activeRecipeSession?.recipeId && getRecipe(activeRecipeSession.recipeId)) {
    return { recipeId: activeRecipeSession.recipeId, source: 'session' };
  }

  if (url) {
    let host;
    try { host = new URL(url).hostname; } catch {}
    const matches = matchRecipes({ host, url });
    if (matches.length > 0) return { recipeId: matches[0].id, source: 'url' };
  }

  return { recipeId: 'generic-setup', source: 'generic' };
}
