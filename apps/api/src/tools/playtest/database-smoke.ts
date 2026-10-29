import { guardPlaytestDatabase } from './database-guard.js';

const target = await guardPlaytestDatabase();
console.log(
  `Playtest database isolation verified for ${target.hostname}/${target.pathname.slice(1)}`
);
