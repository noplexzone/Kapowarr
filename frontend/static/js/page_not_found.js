'use strict';

const theme = JSON.parse(localStorage.getItem('kapowarr') || '{}').theme || 'light';
if (theme !== 'light') {
  document.querySelector(':root').classList.add(`${theme}-mode`);
}
