import { t } from './i18n';

/** Site footer (same markup as the landing page's static footer). */
export function renderFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  const brand = footer.appendChild(document.createElement('a'));
  brand.className = 'brand';
  brand.href = './index.html';
  brand.textContent = 'Charturbo';
  footer.appendChild(document.createElement('span')).textContent = t('landing.footer');
  const source = footer.appendChild(document.createElement('a'));
  source.href = 'https://github.com/jparkk0517/Charturbo';
  source.textContent = t('landing.source');
  return footer;
}
