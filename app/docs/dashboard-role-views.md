# Dashboard role views

Dashboard role view and authorization role permission are separate decisions. The role view in `lib/dashboard.ts` chooses the default sections and their order. Existing authorization determines which sections can run, which records they read, and which actions or reports a user may open. Future Administration settings may change role presentation without granting access.

Sales KPIs use the current calendar quarter in New York and one selected currency. Individual amounts come from `forecastForRep`; team amounts sum the visible reps through `forecastForTeam`. Team coverage divides aggregate Pipeline, Weighted Pipeline, or Commit by the aggregate target. Coverage is unavailable when any visible rep lacks a target. No currency conversion is performed.

Pipeline tables and closing Opportunities use the Pipeline report service with the same quarter, currency, and forecast categories. Account attention uses the Engagement threshold and Account scope. Project, partner, and Price Exception summaries await their dedicated reports.
