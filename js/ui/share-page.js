// Entry point for the static About page (it has no app script): builds the share buttons in English.
import { makeT } from '../i18n.js';
import { mountShare } from './share.js';
mountShare(document.getElementById('share-actions'), makeT(document.documentElement.lang === 'ur' ? 'ur' : 'en'));
