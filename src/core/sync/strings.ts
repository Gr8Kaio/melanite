import { registerStrings } from '../../app/i18n';

registerStrings({
  es: {
    'sync.conflict': 'conflicto',
    'sync.noticeEdit': 'Conflicto de sincronización en "{path}": tu versión quedó en "{copy}".',
    'sync.noticeRename': '"{local}" también se renombró en otro dispositivo: quedó como "{path}".',
    'sync.noticePath': 'Ya había otro "{path}" en la nube: el tuyo ahora es "{copy}".',
  },
  en: {
    'sync.conflict': 'conflict',
    'sync.noticeEdit': 'Sync conflict in "{path}": your version was saved as "{copy}".',
    'sync.noticeRename': '"{local}" was also renamed on another device: it is now "{path}".',
    'sync.noticePath': 'Another "{path}" already existed in the cloud: yours is now "{copy}".',
  },
});
