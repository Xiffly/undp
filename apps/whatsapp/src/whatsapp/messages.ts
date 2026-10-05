export const SUPPORTED_LANGS = ['en', 'ar', 'fr', 'es', 'ru', 'zh'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const ARABIC_RE = /[\u0600-\u06FF]/;
const CYRILLIC_RE = /[\u0400-\u04FF]/;
const CHINESE_RE = /[\u4E00-\u9FFF]/;

const LANGUAGE_ALIASES: Record<string, Lang> = {
  en: 'en',
  english: 'en',
  ar: 'ar',
  arabic: 'ar',
  عربي: 'ar',
  fr: 'fr',
  francais: 'fr',
  français: 'fr',
  french: 'fr',
  es: 'es',
  espanol: 'es',
  español: 'es',
  spanish: 'es',
  ru: 'ru',
  russian: 'ru',
  русский: 'ru',
  zh: 'zh',
  chinese: 'zh',
  中文: 'zh',
};

const COMMANDS = {
  help: ['help', 'menu', 'start', 'ayuda', 'aide', 'помощь', 'меню', '帮助', '开始', 'مساعدة', 'قائمة', 'ابدأ'],
  report: ['1', 'report', 'signaler', 'reportar', 'сообщить', '报告', 'الإبلاغ'],
  status: ['2', 'status', 'statut', 'estado', 'статус', '状态', 'الحالة'],
  yes: ['yes', 'y', '1', 'oui', 'si', 'sí', 'да', '是', 'نعم', 'urgent', 'طارئ'],
  no: ['no', 'n', '0', 'non', 'нет', '否', 'لا'],
  skip: ['skip', 'done', 'pass', 'ignorer', 'saltar', 'пропустить', 'готово', '跳过', '完成', 'تخطي', 'تم'],
} as const;

type MessageValue = string | ((data: any) => string);

const T: Record<string, Record<Lang, MessageValue>> = {
  welcome: {
    en: `UNDP Crisis Reporter\n\nReply with:\n1 - Report damage\n2 - Check report status\n\nYou can also change language: en / ar / fr / es / ru / zh`,
    ar: `مراسل الأزمات من برنامج الأمم المتحدة الإنمائي\n\nاختر:\n1 - الإبلاغ عن ضرر\n2 - التحقق من حالة التقرير\n\nيمكنك أيضاً تغيير اللغة: en / ar / fr / es / ru / zh`,
    fr: `UNDP Crisis Reporter\n\nRépondez:\n1 - Signaler des dommages\n2 - Vérifier le statut d'un rapport\n\nVous pouvez aussi changer de langue: en / ar / fr / es / ru / zh`,
    es: `UNDP Crisis Reporter\n\nResponda:\n1 - Reportar daños\n2 - Consultar el estado de un reporte\n\nTambién puede cambiar el idioma: en / ar / fr / es / ru / zh`,
    ru: `UNDP Crisis Reporter\n\nОтветьте:\n1 - Сообщить о повреждении\n2 - Проверить статус отчета\n\nВы также можете сменить язык: en / ar / fr / es / ru / zh`,
    zh: `UNDP 危机报告平台\n\n回复：\n1 - 报告损坏\n2 - 查询报告状态\n\n也可以切换语言：en / ar / fr / es / ru / zh`,
  },
  language_switched: {
    en: `Language updated to English.`,
    ar: `تم تغيير اللغة إلى العربية.`,
    fr: `La langue a été changée en français.`,
    es: `El idioma se cambió a español.`,
    ru: `Язык переключен на русский.`,
    zh: `语言已切换为中文。`,
  },
  ask_status_id: {
    en: `Send your report ID. Example: CR-2026-0001`,
    ar: `أرسل رقم التقرير. مثال: CR-2026-0001`,
    fr: `Envoyez l'identifiant du rapport. Exemple : CR-2026-0001`,
    es: `Envíe el ID del reporte. Ejemplo: CR-2026-0001`,
    ru: `Отправьте идентификатор отчета. Пример: CR-2026-0001`,
    zh: `请发送报告编号，例如：CR-2026-0001`,
  },
  ask_location: {
    en: `Step 1 of 5: send GPS location or type the address/area name.`,
    ar: `الخطوة 1 من 5: أرسل موقع GPS أو اكتب العنوان/اسم المنطقة.`,
    fr: `Étape 1 sur 5 : envoyez votre position GPS ou saisissez l'adresse/la zone.`,
    es: `Paso 1 de 5: envíe su ubicación GPS o escriba la dirección/zona.`,
    ru: `Шаг 1 из 5: отправьте GPS-локацию или напишите адрес/район.`,
    zh: `第 1 步（共 5 步）：发送 GPS 位置，或输入地址/区域名称。`,
  },
  gps_required: {
    en: `Location description saved. Now please send GPS location so the report can be placed on the map.`,
    ar: `تم حفظ وصف الموقع. الآن يرجى إرسال موقع GPS حتى يمكن وضع التقرير على الخريطة.`,
    fr: `La description du lieu est enregistrée. Envoyez maintenant la position GPS pour placer le rapport sur la carte.`,
    es: `Se guardó la descripción del lugar. Ahora envíe la ubicación GPS para colocar el reporte en el mapa.`,
    ru: `Описание места сохранено. Теперь отправьте GPS-локацию, чтобы разместить отчет на карте.`,
    zh: `位置描述已保存。现在请发送 GPS 位置，以便将报告放置到地图上。`,
  },
  ask_infra: {
    en: `Step 2 of 7: damaged infrastructure type\n1 House/Building\n2 Road/Bridge\n3 School\n4 Hospital/Clinic\n5 Water system\n6 Power/Electricity\n7 Market/Commerce\n8 Other\nReply with number(s), for example: 1 or 1,5`,
    ar: `الخطوة 2 من 5: نوع البنية التحتية المتضررة\n1 منزل/مبنى\n2 طريق/جسر\n3 مدرسة\n4 مستشفى/عيادة\n5 نظام مياه\n6 كهرباء\n7 سوق/تجارة\n8 أخرى\nأرسل الرقم أو الأرقام، مثال: 1 أو 1,5`,
    fr: `Étape 2 sur 5 : type d'infrastructure endommagée\n1 Maison/Bâtiment\n2 Route/Pont\n3 École\n4 Hôpital/Clinique\n5 Réseau d'eau\n6 Électricité\n7 Marché/Commerce\n8 Autre\nRépondez avec le ou les numéros, par exemple : 1 ou 1,5`,
    es: `Paso 2 de 5: tipo de infraestructura dañada\n1 Casa/Edificio\n2 Carretera/Puente\n3 Escuela\n4 Hospital/Clínica\n5 Sistema de agua\n6 Energía/Electricidad\n7 Mercado/Comercio\n8 Otro\nResponda con uno o más números, por ejemplo: 1 o 1,5`,
    ru: `Шаг 2 из 5: тип поврежденной инфраструктуры\n1 Дом/здание\n2 Дорога/мост\n3 Школа\n4 Больница/клиника\n5 Система водоснабжения\n6 Электричество\n7 Рынок/торговля\n8 Другое\nОтветьте номером или номерами, например: 1 или 1,5`,
    zh: `第 2 步（共 5 步）：受损基础设施类型\n1 房屋/建筑\n2 道路/桥梁\n3 学校\n4 医院/诊所\n5 供水系统\n6 电力/电网\n7 市场/商业\n8 其他\n请回复数字，例如：1 或 1,5`,
  },
  ask_crisis: {
    en: `Step 3 of 7: crisis type\n1 Earthquake\n2 Flood\n3 Tsunami\n4 Hurricane/Cyclone\n5 Wildfire\n6 Explosion\n7 Chemical incident\n8 Conflict\n9 Civil unrest`,
    ar: `الخطوة 3 من 7: نوع الأزمة\n1 زلزال\n2 فيضان\n3 تسونامي\n4 إعصار/عاصفة\n5 حريق غابات\n6 انفجار\n7 حادث كيميائي\n8 نزاع\n9 اضطرابات مدنية`,
    fr: `Étape 3 sur 7 : type de crise\n1 Tremblement de terre\n2 Inondation\n3 Tsunami\n4 Ouragan/Cyclone\n5 Feu de forêt\n6 Explosion\n7 Incident chimique\n8 Conflit\n9 Troubles civils`,
    es: `Paso 3 de 7: tipo de crisis\n1 Terremoto\n2 Inundación\n3 Tsunami\n4 Huracán/Ciclón\n5 Incendio forestal\n6 Explosión\n7 Incidente químico\n8 Conflicto\n9 Disturbios civiles`,
    ru: `Шаг 3 из 7: тип кризиса\n1 Землетрясение\n2 Наводнение\n3 Цунами\n4 Ураган/циклон\n5 Лесной пожар\n6 Взрыв\n7 Химический инцидент\n8 Конфликт\n9 Гражданские беспорядки`,
    zh: `第 3 步（共 7 步）：危机类型\n1 地震\n2 洪水\n3 海啸\n4 飓风/气旋\n5 野火\n6 爆炸\n7 化学事故\n8 冲突\n9 社会骚乱`,
  },
  ask_damage: {
    en: `Step 4 of 7: damage level\n1 Minimal\n2 Partial\n3 Destroyed`,
    ar: `الخطوة 3 من 5: مستوى الضرر\n1 طفيف\n2 جزئي\n3 مدمر`,
    fr: `Étape 3 sur 5 : niveau de dommage\n1 Minimal\n2 Partiel\n3 Détruit`,
    es: `Paso 3 de 5: nivel de daño\n1 Mínimo\n2 Parcial\n3 Destruido`,
    ru: `Шаг 3 из 5: уровень повреждения\n1 Минимальный\n2 Частичный\n3 Разрушено`,
    zh: `第 3 步（共 5 步）：损坏程度\n1 轻微\n2 部分损坏\n3 完全损毁`,
  },
  ask_urgent: {
    en: `Is this urgent? Reply YES or NO.`,
    ar: `هل هذه الحالة عاجلة؟ أرسل نعم أو لا.`,
    fr: `Est-ce urgent ? Répondez OUI ou NON.`,
    es: `¿Es urgente? Responda SÍ o NO.`,
    ru: `Это срочно? Ответьте ДА или НЕТ.`,
    zh: `是否紧急？请回复 是 或 否。`,
  },
  ask_needs: {
    en: `Step 5 of 7: most urgent needs\n1 Food and drinking water\n2 Cash assistance\n3 Healthcare and medicines\n4 Shelter or housing repair\n5 Livelihood support\n6 Water, sanitation, hygiene\n7 Restore infrastructure/services\n8 Protection or psychosocial support\n9 Local authority/community support\n10 Other\nReply with number(s), for example: 1,3`,
    ar: `الخطوة 5 من 7: الاحتياجات الأكثر إلحاحاً\n1 غذاء ومياه شرب\n2 مساعدات نقدية\n3 رعاية صحية وأدوية\n4 مأوى أو إصلاح سكن\n5 دعم سبل العيش\n6 مياه وصرف صحي ونظافة\n7 استعادة الخدمات والبنية التحتية\n8 حماية أو دعم نفسي اجتماعي\n9 دعم السلطات المحلية/المنظمات المجتمعية\n10 أخرى\nأرسل الرقم أو الأرقام، مثال: 1,3`,
    fr: `Étape 5 sur 7 : besoins les plus urgents\n1 Nourriture et eau potable\n2 Aide financière\n3 Soins de santé et médicaments\n4 Abri ou réparation du logement\n5 Soutien aux moyens de subsistance\n6 Eau, assainissement et hygiène\n7 Rétablir les services et infrastructures\n8 Protection ou soutien psychosocial\n9 Soutien des autorités locales/organisations communautaires\n10 Autre\nRépondez avec le ou les numéros, par exemple : 1,3`,
    es: `Paso 5 de 7: necesidades más urgentes\n1 Alimentos y agua potable\n2 Asistencia en efectivo\n3 Atención médica y medicinas\n4 Refugio o reparación de vivienda\n5 Apoyo a medios de vida\n6 Agua, saneamiento e higiene\n7 Restablecer infraestructura/servicios\n8 Protección o apoyo psicosocial\n9 Apoyo de autoridades locales/organizaciones comunitarias\n10 Otro\nResponda con uno o más números, por ejemplo: 1,3`,
    ru: `Шаг 5 из 7: самые срочные потребности\n1 Продукты и питьевая вода\n2 Денежная помощь\n3 Медицинская помощь и лекарства\n4 Укрытие или ремонт жилья\n5 Поддержка источников дохода\n6 Вода, санитария и гигиена\n7 Восстановление инфраструктуры/услуг\n8 Защита или психосоциальная поддержка\n9 Поддержка местных властей/общественных организаций\n10 Другое\nОтветьте номером или номерами, например: 1,3`,
    zh: `第 5 步（共 7 步）：最紧急需求\n1 食物和安全饮用水\n2 现金援助\n3 医疗和药品\n4 住所或住房修复\n5 生计支持\n6 供水、卫生和清洁\n7 恢复基础设施/基本服务\n8 保护或心理社会支持\n9 地方政府/社区组织支持\n10 其他\n请回复一个或多个数字，例如：1,3`,
  },
  ask_photos: {
    en: `Step 6 of 7: send up to 3 photos. Reply DONE or SKIP when finished.`,
    ar: `الخطوة 4 من 5: أرسل حتى 3 صور. اكتب تم أو تخطي عند الانتهاء.`,
    fr: `Étape 4 sur 5 : envoyez jusqu'à 3 photos. Répondez TERMINÉ ou PASSER quand vous avez fini.`,
    es: `Paso 4 de 5: envíe hasta 3 fotos. Responda LISTO o SALTAR al terminar.`,
    ru: `Шаг 4 из 5: отправьте до 3 фотографий. Ответьте ГОТОВО или ПРОПУСТИТЬ после завершения.`,
    zh: `第 4 步（共 5 步）：最多发送 3 张照片。完成后回复 完成 或 跳过。`,
  },
  ask_description: {
    en: `Step 7 of 7: add a short description, or reply SKIP.`,
    ar: `الخطوة 5 من 5: أضف وصفاً قصيراً، أو اكتب تخطي.`,
    fr: `Étape 5 sur 5 : ajoutez une courte description, ou répondez PASSER.`,
    es: `Paso 5 de 5: agregue una descripción breve, o responda SALTAR.`,
    ru: `Шаг 5 из 5: добавьте краткое описание или ответьте ПРОПУСТИТЬ.`,
    zh: `第 5 步（共 5 步）：添加简短描述，或回复 跳过。`,
  },
  confirm: {
    en: (data: any) => `Ready to submit\nLocation: ${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\nType: ${data.infra_labels}\nCrisis: ${data.crisis_label}\nDamage: ${data.damage_label}\nUrgent: ${data.is_urgent ? 'Yes' : 'No'}\nNeeds: ${data.needs_label}\nPhotos: ${data.photo_count}${data.description ? `\nDescription: ${data.description}` : ''}\n\nReply YES to submit or NO to start over.`,
    ar: (data: any) => `جاهز للإرسال\nالموقع: ${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\nالنوع: ${data.infra_labels}\nالضرر: ${data.damage_label}\nعاجل: ${data.is_urgent ? 'نعم' : 'لا'}\nالصور: ${data.photo_count}${data.description ? `\nالوصف: ${data.description}` : ''}\n\nأرسل نعم للإرسال أو لا للبدء من جديد.`,
    fr: (data: any) => `Prêt à envoyer\nLieu : ${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\nType : ${data.infra_labels}\nDommage : ${data.damage_label}\nUrgent : ${data.is_urgent ? 'Oui' : 'Non'}\nPhotos : ${data.photo_count}${data.description ? `\nDescription : ${data.description}` : ''}\n\nRépondez OUI pour envoyer ou NON pour recommencer.`,
    es: (data: any) => `Listo para enviar\nUbicación: ${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\nTipo: ${data.infra_labels}\nDaño: ${data.damage_label}\nUrgente: ${data.is_urgent ? 'Sí' : 'No'}\nFotos: ${data.photo_count}${data.description ? `\nDescripción: ${data.description}` : ''}\n\nResponda SÍ para enviar o NO para empezar de nuevo.`,
    ru: (data: any) => `Готово к отправке\nМесто: ${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\nТип: ${data.infra_labels}\nПовреждение: ${data.damage_label}\nСрочно: ${data.is_urgent ? 'Да' : 'Нет'}\nФото: ${data.photo_count}${data.description ? `\nОписание: ${data.description}` : ''}\n\nОтветьте ДА для отправки или НЕТ для перезапуска.`,
    zh: (data: any) => `准备提交\n位置：${data.address_text || `${data.lat?.toFixed(4)}, ${data.lng?.toFixed(4)}`}\n类型：${data.infra_labels}\n损坏：${data.damage_label}\n紧急：${data.is_urgent ? '是' : '否'}\n照片：${data.photo_count}${data.description ? `\n描述：${data.description}` : ''}\n\n回复 是 提交，或回复 否 重新开始。`,
  },
  submitted: {
    en: (data: any) => `Report submitted.\nReference: ${data.reportId}\nBadge: ${data.badgeLabel}\nTrust score: ${data.trustScore}\nThank you for helping your community.`,
    ar: (data: any) => `تم إرسال التقرير.\nالمرجع: ${data.reportId}\nالشارة: ${data.badgeLabel}\nدرجة الثقة: ${data.trustScore}\nشكراً لمساعدتك لمجتمعك.`,
    fr: (data: any) => `Rapport envoyé.\nRéférence : ${data.reportId}\nBadge : ${data.badgeLabel}\nScore de confiance : ${data.trustScore}\nMerci pour votre aide à la communauté.`,
    es: (data: any) => `Reporte enviado.\nReferencia: ${data.reportId}\nInsignia: ${data.badgeLabel}\nPuntuación de confianza: ${data.trustScore}\nGracias por ayudar a su comunidad.`,
    ru: (data: any) => `Отчет отправлен.\nНомер: ${data.reportId}\nСтатус участника: ${data.badgeLabel}\nРейтинг доверия: ${data.trustScore}\nСпасибо за помощь сообществу.`,
    zh: (data: any) => `报告已提交。\n编号：${data.reportId}\n徽章：${data.badgeLabel}\n信任分：${data.trustScore}\n感谢您帮助社区。`,
  },
  status_not_found: {
    en: `No report found. Send a valid report ID or reply 1 to start a new report.`,
    ar: `لم يتم العثور على التقرير. أرسل رقم تقرير صحيحاً أو اكتب 1 لبدء تقرير جديد.`,
    fr: `Aucun rapport trouvé. Envoyez un identifiant valide ou répondez 1 pour créer un nouveau rapport.`,
    es: `No se encontró el reporte. Envíe un ID válido o responda 1 para crear un nuevo reporte.`,
    ru: `Отчет не найден. Отправьте правильный ID или ответьте 1, чтобы создать новый отчет.`,
    zh: `未找到报告。请发送有效的报告编号，或回复 1 开始新报告。`,
  },
  status_report: {
    en: (r: any) => `Report ${r.id}\nDamage: ${r.damage_level}\nType: ${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\nLocation: ${r.address_text || 'GPS coordinates'}\nStatus: ${String(r.status || '').toUpperCase()}\nCommunity confirmations: ${r.community_confirms}`,
    ar: (r: any) => `التقرير ${r.id}\nالضرر: ${r.damage_level}\nالنوع: ${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\nالموقع: ${r.address_text || 'إحداثيات GPS'}\nالحالة: ${String(r.status || '').toUpperCase()}\nتأكيدات المجتمع: ${r.community_confirms}`,
    fr: (r: any) => `Rapport ${r.id}\nDommage : ${r.damage_level}\nType : ${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\nLieu : ${r.address_text || 'Coordonnées GPS'}\nStatut : ${String(r.status || '').toUpperCase()}\nConfirmations communautaires : ${r.community_confirms}`,
    es: (r: any) => `Reporte ${r.id}\nDaño: ${r.damage_level}\nTipo: ${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\nUbicación: ${r.address_text || 'Coordenadas GPS'}\nEstado: ${String(r.status || '').toUpperCase()}\nConfirmaciones de la comunidad: ${r.community_confirms}`,
    ru: (r: any) => `Отчет ${r.id}\nПовреждение: ${r.damage_level}\nТип: ${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\nМесто: ${r.address_text || 'GPS координаты'}\nСтатус: ${String(r.status || '').toUpperCase()}\nПодтверждения сообщества: ${r.community_confirms}`,
    zh: (r: any) => `报告 ${r.id}\n损坏：${r.damage_level}\n类型：${Array.isArray(r.infra_types) ? r.infra_types.join(', ') : r.infra_types}\n位置：${r.address_text || 'GPS 坐标'}\n状态：${String(r.status || '').toUpperCase()}\n社区确认：${r.community_confirms}`,
  },
  invalid_infra: {
    en: `Reply with valid numbers between 1 and 8. Example: 1 or 1,3,5`,
    ar: `أرسل أرقاماً صحيحة بين 1 و 8. مثال: 1 أو 1,3,5`,
    fr: `Répondez avec des numéros valides entre 1 et 8. Exemple : 1 ou 1,3,5`,
    es: `Responda con números válidos entre 1 y 8. Ejemplo: 1 o 1,3,5`,
    ru: `Ответьте корректными числами от 1 до 8. Пример: 1 или 1,3,5`,
    zh: `请回复 1 到 8 之间的有效数字，例如：1 或 1,3,5`,
  },
  invalid_crisis: {
    en: `Reply with a valid number between 1 and 9 for crisis type.`,
    ar: `أرسل رقماً صحيحاً بين 1 و 9 لنوع الأزمة.`,
    fr: `Répondez avec un numéro valide entre 1 et 9 pour le type de crise.`,
    es: `Responda con un número válido entre 1 y 9 para el tipo de crisis.`,
    ru: `Ответьте корректным числом от 1 до 9 для типа кризиса.`,
    zh: `请选择 1 到 9 之间的有效数字表示危机类型。`,
  },
  invalid_damage: {
    en: `Reply with 1, 2 or 3 for damage level.`,
    ar: `أرسل 1 أو 2 أو 3 لمستوى الضرر.`,
    fr: `Répondez avec 1, 2 ou 3 pour le niveau de dommage.`,
    es: `Responda con 1, 2 o 3 para el nivel de daño.`,
    ru: `Ответьте 1, 2 или 3 для уровня повреждения.`,
    zh: `请回复 1、2 或 3 表示损坏程度。`,
  },
  invalid_needs: {
    en: `Reply with valid numbers between 1 and 10. Example: 1 or 1,3,7`,
    ar: `أرسل أرقاماً صحيحة بين 1 و 10. مثال: 1 أو 1,3,7`,
    fr: `Répondez avec des numéros valides entre 1 et 10. Exemple : 1 ou 1,3,7`,
    es: `Responda con números válidos entre 1 y 10. Ejemplo: 1 o 1,3,7`,
    ru: `Ответьте корректными числами от 1 до 10. Пример: 1 или 1,3,7`,
    zh: `请回复 1 到 10 之间的有效数字，例如：1 或 1,3,7`,
  },
  photo_received: {
    en: (n: number) => `Photo ${n} received. Send more or reply DONE.`,
    ar: (n: number) => `تم استلام الصورة ${n}. أرسل المزيد أو اكتب تم.`,
    fr: (n: number) => `Photo ${n} reçue. Envoyez-en d'autres ou répondez TERMINÉ.`,
    es: (n: number) => `Foto ${n} recibida. Envíe más o responda LISTO.`,
    ru: (n: number) => `Фото ${n} получено. Отправьте еще или ответьте ГОТОВО.`,
    zh: (n: number) => `已收到第 ${n} 张照片。可继续发送，或回复 完成。`,
  },
  photo_limit: {
    en: `Maximum 3 photos received. Reply DONE to continue.`,
    ar: `تم استلام الحد الأقصى 3 صور. اكتب تم للمتابعة.`,
    fr: `Maximum de 3 photos atteint. Répondez TERMINÉ pour continuer.`,
    es: `Se alcanzó el máximo de 3 fotos. Responda LISTO para continuar.`,
    ru: `Достигнут максимум 3 фото. Ответьте ГОТОВО для продолжения.`,
    zh: `最多只能发送 3 张照片。请回复 完成 继续。`,
  },
  error: {
    en: `Something went wrong. Reply 1 to start a new report.`,
    ar: `حدث خطأ ما. اكتب 1 لبدء تقرير جديد.`,
    fr: `Une erreur s'est produite. Répondez 1 pour commencer un nouveau rapport.`,
    es: `Algo salió mal. Responda 1 para iniciar un nuevo reporte.`,
    ru: `Произошла ошибка. Ответьте 1, чтобы начать новый отчет.`,
    zh: `发生错误。请回复 1 开始新报告。`,
  },
  verify_success: {
    en: `Phone verified. Your website account and WhatsApp contributor profile are now linked.`,
    ar: `تم التحقق من الهاتف. تم الآن ربط حساب الموقع وملف مساهم واتساب.`,
    fr: `Téléphone vérifié. Votre compte du site et votre profil contributeur WhatsApp sont maintenant liés.`,
    es: `Teléfono verificado. Su cuenta web y su perfil de colaborador en WhatsApp ahora están vinculados.`,
    ru: `Телефон подтвержден. Ваш аккаунт на сайте и профиль участника WhatsApp теперь связаны.`,
    zh: `手机号已验证。您的网站账户与 WhatsApp 贡献者资料现已关联。`,
  },
  verify_no_pending: {
    en: `No pending verification was found for this phone. Start verification again on the website if you are changing devices or numbers.`,
    ar: `لم يتم العثور على طلب تحقق معلق لهذا الهاتف. ابدأ التحقق مرة أخرى من الموقع إذا كنت تغيّر الجهاز أو الرقم.`,
    fr: `Aucune vérification en attente n'a été trouvée pour ce numéro. Redémarrez la vérification sur le site si vous changez d'appareil ou de numéro.`,
    es: `No se encontró una verificación pendiente para este teléfono. Inicie la verificación nuevamente en el sitio web si está cambiando de dispositivo o número.`,
    ru: `Для этого телефона не найден ожидающий запрос на проверку. Запустите проверку заново на сайте, если вы меняете устройство или номер.`,
    zh: `此手机号没有待处理的验证请求。如果您正在更换设备或号码，请回到网站重新发起验证。`,
  },
  verify_invalid: {
    en: `That verification code does not match the active request. Check the latest code on the website and try again.`,
    ar: `رمز التحقق هذا لا يطابق الطلب النشط. تحقق من أحدث رمز على الموقع وحاول مرة أخرى.`,
    fr: `Ce code de vérification ne correspond pas à la demande active. Vérifiez le dernier code sur le site et réessayez.`,
    es: `Ese código de verificación no coincide con la solicitud activa. Revise el último código en el sitio y vuelva a intentarlo.`,
    ru: `Этот код подтверждения не соответствует активному запросу. Проверьте последний код на сайте и попробуйте снова.`,
    zh: `该验证码与当前请求不匹配。请检查网站上的最新验证码后重试。`,
  },
  verify_expired: {
    en: `That verification code expired. Start verification again on the website to get a fresh code.`,
    ar: `انتهت صلاحية رمز التحقق هذا. ابدأ التحقق مرة أخرى من الموقع للحصول على رمز جديد.`,
    fr: `Ce code de vérification a expiré. Redémarrez la vérification sur le site pour obtenir un nouveau code.`,
    es: `Ese código de verificación expiró. Inicie la verificación nuevamente en el sitio web para obtener un código nuevo.`,
    ru: `Срок действия этого кода подтверждения истек. Запустите проверку заново на сайте, чтобы получить новый код.`,
    zh: `该验证码已过期。请回到网站重新发起验证以获取新验证码。`,
  },
  verify_conflict: {
    en: `This phone is already verified on another account. Use a different number or contact an administrator if this is a real ownership issue.`,
    ar: `هذا الرقم موثّق بالفعل على حساب آخر. استخدم رقماً مختلفاً أو تواصل مع المسؤول إذا كانت هناك مشكلة ملكية فعلية.`,
    fr: `Ce numéro est déjà vérifié sur un autre compte. Utilisez un autre numéro ou contactez un administrateur si c'est un vrai problème de propriété.`,
    es: `Este número ya está verificado en otra cuenta. Use otro número o contacte a un administrador si se trata de un problema real de titularidad.`,
    ru: `Этот номер уже подтвержден для другой учетной записи. Используйте другой номер или свяжитесь с администратором, если это реальный спор о владении.`,
    zh: `该手机号已绑定到其他账户。如果确实存在归属问题，请改用其他号码或联系管理员。`,
  },
  verify_failed: {
    en: `Verification could not be completed. Start again on the website if needed.`,
    ar: `تعذر إكمال التحقق. ابدأ من جديد عبر الموقع إذا لزم الأمر.`,
    fr: `La vérification n'a pas pu être terminée. Recommencez sur le site si nécessaire.`,
    es: `No se pudo completar la verificación. Vuelva a iniciarla desde el sitio web si es necesario.`,
    ru: `Не удалось завершить проверку. При необходимости запустите ее заново на сайте.`,
    zh: `验证未能完成。如有需要，请回到网站重新开始。`,
  },
} as const;

export const INFRA_MAP: Record<string, string> = {
  '1': 'house', '2': 'road', '3': 'school', '4': 'hospital',
  '5': 'water', '6': 'power', '7': 'market', '8': 'other',
};

export const INFRA_LABELS: Record<string, Record<Lang, string>> = {
  house: { en: 'House/Building', ar: 'منزل/مبنى', fr: 'Maison/Bâtiment', es: 'Casa/Edificio', ru: 'Дом/здание', zh: '房屋/建筑' },
  road: { en: 'Road/Bridge', ar: 'طريق/جسر', fr: 'Route/Pont', es: 'Carretera/Puente', ru: 'Дорога/мост', zh: '道路/桥梁' },
  school: { en: 'School', ar: 'مدرسة', fr: 'École', es: 'Escuela', ru: 'Школа', zh: '学校' },
  hospital: { en: 'Hospital/Clinic', ar: 'مستشفى/عيادة', fr: 'Hôpital/Clinique', es: 'Hospital/Clínica', ru: 'Больница/клиника', zh: '医院/诊所' },
  water: { en: 'Water system', ar: 'نظام مياه', fr: 'Réseau d\'eau', es: 'Sistema de agua', ru: 'Система водоснабжения', zh: '供水系统' },
  power: { en: 'Power/Electricity', ar: 'كهرباء', fr: 'Électricité', es: 'Electricidad', ru: 'Электроснабжение', zh: '电力系统' },
  market: { en: 'Market/Commerce', ar: 'سوق/تجارة', fr: 'Marché/Commerce', es: 'Mercado/Comercio', ru: 'Рынок/торговля', zh: '市场/商业' },
  other: { en: 'Other', ar: 'أخرى', fr: 'Autre', es: 'Otro', ru: 'Другое', zh: '其他' },
};

export const DAMAGE_LABELS: Record<string, Record<Lang, string>> = {
  minimal: { en: 'Minimal', ar: 'طفيف', fr: 'Minimal', es: 'Mínimo', ru: 'Минимальный', zh: '轻微' },
  partial: { en: 'Partial', ar: 'جزئي', fr: 'Partiel', es: 'Parcial', ru: 'Частичный', zh: '部分损坏' },
  destroyed: { en: 'Destroyed', ar: 'مدمر', fr: 'Détruit', es: 'Destruido', ru: 'Разрушено', zh: '完全损毁' },
};

export const CRISIS_MAP: Record<string, string> = {
  '1': 'earthquake',
  '2': 'flood',
  '3': 'tsunami',
  '4': 'hurricane',
  '5': 'wildfire',
  '6': 'explosion',
  '7': 'chemical',
  '8': 'conflict',
  '9': 'civil_unrest',
};

export const CRISIS_LABELS: Record<string, Record<Lang, string>> = {
  earthquake: { en: 'Earthquake', ar: 'زلزال', fr: 'Tremblement de terre', es: 'Terremoto', ru: 'Землетрясение', zh: '地震' },
  flood: { en: 'Flood', ar: 'فيضان', fr: 'Inondation', es: 'Inundación', ru: 'Наводнение', zh: '洪水' },
  tsunami: { en: 'Tsunami', ar: 'تسونامي', fr: 'Tsunami', es: 'Tsunami', ru: 'Цунами', zh: '海啸' },
  hurricane: { en: 'Hurricane / Cyclone', ar: 'إعصار / عاصفة', fr: 'Ouragan / Cyclone', es: 'Huracán / Ciclón', ru: 'Ураган / циклон', zh: '飓风 / 气旋' },
  wildfire: { en: 'Wildfire', ar: 'حريق غابات', fr: 'Feu de forêt', es: 'Incendio forestal', ru: 'Лесной пожар', zh: '野火' },
  explosion: { en: 'Explosion', ar: 'انفجار', fr: 'Explosion', es: 'Explosión', ru: 'Взрыв', zh: '爆炸' },
  chemical: { en: 'Chemical Incident', ar: 'حادث كيميائي', fr: 'Incident chimique', es: 'Incidente químico', ru: 'Химический инцидент', zh: '化学事故' },
  conflict: { en: 'Conflict', ar: 'نزاع', fr: 'Conflit', es: 'Conflicto', ru: 'Конфликт', zh: '冲突' },
  civil_unrest: { en: 'Civil Unrest', ar: 'اضطرابات مدنية', fr: 'Troubles civils', es: 'Disturbios civiles', ru: 'Гражданские беспорядки', zh: '社会骚乱' },
};

export const NEEDS_MAP: Record<string, string> = {
  '1': 'food_water',
  '2': 'cash',
  '3': 'healthcare',
  '4': 'shelter',
  '5': 'livelihoods',
  '6': 'wash',
  '7': 'infrastructure',
  '8': 'protection',
  '9': 'local_authority',
  '10': 'other',
};

export const NEEDS_LABELS: Record<string, Record<Lang, string>> = {
  food_water: { en: 'Food assistance and safe drinking water', ar: 'غذاء ومياه شرب آمنة', fr: 'Nourriture et eau potable', es: 'Alimentos y agua potable', ru: 'Продукты и безопасная питьевая вода', zh: '食物和安全饮用水' },
  cash: { en: 'Cash or financial assistance', ar: 'مساعدات نقدية أو مالية', fr: 'Aide financière', es: 'Asistencia en efectivo o financiera', ru: 'Денежная или финансовая помощь', zh: '现金或金融援助' },
  healthcare: { en: 'Access to healthcare and essential medicines', ar: 'رعاية صحية وأدوية أساسية', fr: 'Soins de santé et médicaments essentiels', es: 'Atención médica y medicinas esenciales', ru: 'Медицинская помощь и необходимые лекарства', zh: '医疗服务和基本药品' },
  shelter: { en: 'Shelter, housing repair, or temporary accommodation', ar: 'مأوى أو إصلاح سكن أو إقامة مؤقتة', fr: 'Abri, réparation du logement ou hébergement temporaire', es: 'Refugio, reparación de vivienda o alojamiento temporal', ru: 'Укрытие, ремонт жилья или временное размещение', zh: '住所、住房修复或临时安置' },
  livelihoods: { en: 'Restoration of livelihoods or income sources', ar: 'استعادة سبل العيش أو مصادر الدخل', fr: 'Rétablissement des moyens de subsistance ou des revenus', es: 'Restauración de medios de vida o fuentes de ingreso', ru: 'Восстановление средств к существованию или дохода', zh: '恢复生计或收入来源' },
  wash: { en: 'Water, sanitation, and hygiene', ar: 'المياه والصرف الصحي والنظافة', fr: 'Eau, assainissement et hygiène', es: 'Agua, saneamiento e higiene', ru: 'Вода, санитария и гигиена', zh: '供水、卫生和清洁' },
  infrastructure: { en: 'Restoration of basic services and infrastructure', ar: 'استعادة الخدمات الأساسية والبنية التحتية', fr: 'Rétablissement des services de base et des infrastructures', es: 'Restablecimiento de servicios básicos e infraestructura', ru: 'Восстановление базовых услуг и инфраструктуры', zh: '恢复基础设施和基本服务' },
  protection: { en: 'Protection services and psychosocial support', ar: 'خدمات الحماية والدعم النفسي الاجتماعي', fr: 'Protection et soutien psychosocial', es: 'Servicios de protección y apoyo psicosocial', ru: 'Защита и психосоциальная поддержка', zh: '保护服务和心理社会支持' },
  local_authority: { en: 'Support from local authorities and community organizations', ar: 'دعم من السلطات المحلية والمنظمات المجتمعية', fr: 'Soutien des autorités locales et des organisations communautaires', es: 'Apoyo de autoridades locales y organizaciones comunitarias', ru: 'Поддержка местных властей и общественных организаций', zh: '地方政府和社区组织支持' },
  other: { en: 'Other', ar: 'أخرى', fr: 'Autre', es: 'Otro', ru: 'Другое', zh: '其他' },
};

export const BADGE_LABELS: Record<string, Record<Lang, string>> = {
  new_contributor: { en: 'New Contributor', ar: 'مساهم جديد', fr: 'Nouveau contributeur', es: 'Nuevo colaborador', ru: 'Новый участник', zh: '新贡献者' },
  community_helper: { en: 'Community Helper', ar: 'مساعد مجتمعي', fr: 'Assistant communautaire', es: 'Apoyo comunitario', ru: 'Помощник сообщества', zh: '社区协作者' },
  trusted_contributor: { en: 'Trusted Contributor', ar: 'مساهم موثوق', fr: 'Contributeur fiable', es: 'Colaborador confiable', ru: 'Надежный участник', zh: '可信贡献者' },
  local_watch: { en: 'Local Watch', ar: 'مراقب محلي', fr: 'Veille locale', es: 'Vigilancia local', ru: 'Местный дозор', zh: '本地守望' },
};

function normalizeInput(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, '');
}

export function parseLanguageCommand(input: string): Lang | null {
  return LANGUAGE_ALIASES[normalizeInput(input)] || null;
}

export function detectLang(text: string): Lang {
  const explicit = parseLanguageCommand(text);
  if (explicit) return explicit;
  if (ARABIC_RE.test(text)) return 'ar';
  if (CYRILLIC_RE.test(text)) return 'ru';
  if (CHINESE_RE.test(text)) return 'zh';
  const lowered = text.toLowerCase();
  if (/\b(hola|gracias|daños|reporte|urgente)\b/.test(lowered)) return 'es';
  if (/\b(bonjour|merci|rapport|urgence|dommages)\b/.test(lowered)) return 'fr';
  return 'en';
}

export function matchesCommand(group: keyof typeof COMMANDS, input: string): boolean {
  const normalized = normalizeInput(input);
  return COMMANDS[group].includes(normalized as never);
}

export function msg(key: string, lang: Lang, data?: any): string {
  const template = T[key]?.[lang] || T[key]?.en;
  if (!template) return '';
  return typeof template === 'function' ? template(data) : template;
}

export function infraLabel(types: string[], lang: Lang): string {
  return types.map((k) => INFRA_LABELS[k]?.[lang] || k).join(', ');
}

export function damageLabel(level: string, lang: Lang): string {
  return DAMAGE_LABELS[level]?.[lang] || level;
}

export function crisisLabel(crisisType: string, lang: Lang): string {
  return CRISIS_LABELS[crisisType]?.[lang] || crisisType;
}

export function needsLabel(needs: string[], lang: Lang): string {
  if (!needs.length) return lang === 'ar' ? 'لا شيء محدد' : lang === 'fr' ? 'Aucun indiqué' : lang === 'es' ? 'No especificado' : lang === 'ru' ? 'Не указано' : lang === 'zh' ? '未说明' : 'Not specified';
  return needs.map((need) => {
    if (need.startsWith('other:')) return need.slice(6);
    return NEEDS_LABELS[need]?.[lang] || need;
  }).join(', ');
}

export function badgeLabel(badge: string, lang: Lang): string {
  return BADGE_LABELS[badge]?.[lang] || BADGE_LABELS.new_contributor[lang];
}

export function parseInfraInput(input: string): string[] | null {
  const nums = input.replace(/\s/g, '').split(',').filter(Boolean);
  if (!nums.length) return null;
  const types: string[] = [];
  for (const n of nums) {
    const mapped = INFRA_MAP[n];
    if (!mapped) return null;
    if (!types.includes(mapped)) types.push(mapped);
  }
  return types;
}

export function parseDamageInput(input: string): 'minimal' | 'partial' | 'destroyed' | null {
  const normalized = input.toLowerCase().trim();
  const map: Record<string, 'minimal' | 'partial' | 'destroyed'> = {
    '1': 'minimal',
    minimal: 'minimal',
    minimum: 'minimal',
    '2': 'partial',
    partial: 'partial',
    '3': 'destroyed',
    destroyed: 'destroyed',
    détruit: 'destroyed',
    destruido: 'destroyed',
    разрушено: 'destroyed',
    摧毁: 'destroyed',
  };
  return map[normalized] || null;
}

export function parseCrisisInput(input: string): string | null {
  const normalized = input.toLowerCase().trim();
  if (CRISIS_MAP[normalized]) return CRISIS_MAP[normalized];
  const canonical = normalized.replace(/\s+/g, '_');
  return Object.prototype.hasOwnProperty.call(CRISIS_LABELS, canonical) ? canonical : null;
}

export function parseNeedsInput(input: string): string[] | null {
  const nums = input.replace(/\s/g, '').split(',').filter(Boolean);
  if (!nums.length) return null;
  const needs: string[] = [];
  for (const n of nums) {
    const mapped = NEEDS_MAP[n];
    if (!mapped) return null;
    if (!needs.includes(mapped)) needs.push(mapped);
  }
  return needs;
}
