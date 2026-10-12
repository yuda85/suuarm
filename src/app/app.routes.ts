import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./features/shell/ops-shell').then((m) => m.OpsShell) },
  { path: '**', redirectTo: '' },
];
