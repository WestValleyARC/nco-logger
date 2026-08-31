const entries = (items) => items.map(([emoji, name]) => ({ emoji, name }));
export const CHAT_EMOJI_CATEGORIES = [
    { id: 'smileys', label: 'Smileys & Emotion', icon: '😀', emoji: entries([
            ['😀', 'grinning face'], ['😃', 'grinning face big eyes'], ['😄', 'grinning smiling eyes'],
            ['😁', 'beaming face'], ['😆', 'grinning squinting face'], ['😅', 'grinning sweat'],
            ['😂', 'tears of joy'], ['🤣', 'rolling laughing'], ['😊', 'smiling blush'], ['🙂', 'slightly smiling'],
            ['🙃', 'upside down'], ['😉', 'wink'], ['😍', 'heart eyes'], ['🥰', 'smiling hearts'],
            ['😘', 'kiss'], ['😋', 'savoring food'], ['😎', 'sunglasses cool'], ['🤩', 'star struck'],
            ['🥳', 'party face'], ['🤔', 'thinking'], ['🤨', 'raised eyebrow'], ['😐', 'neutral'],
            ['😕', 'confused'], ['😮', 'surprised'], ['😴', 'sleeping'], ['😢', 'crying'], ['😭', 'sobbing'],
            ['😡', 'angry'], ['🤯', 'mind blown'], ['😱', 'fear scream'], ['❤️', 'red heart'],
            ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'],
            ['💜', 'purple heart'], ['💔', 'broken heart'], ['💯', 'hundred points'], ['💬', 'speech balloon']
        ]) },
    { id: 'people', label: 'People & Body', icon: '👋', emoji: entries([
            ['👋', 'waving hand'], ['🤚', 'raised back hand'], ['✋', 'raised hand'], ['🖖', 'vulcan salute'],
            ['👌', 'ok hand'], ['🤌', 'pinched fingers'], ['🤏', 'pinching hand'], ['✌️', 'victory hand'],
            ['🤞', 'crossed fingers'], ['🫰', 'hand index thumb crossed'], ['🤟', 'love you gesture'],
            ['🤘', 'sign horns'], ['🤙', 'call me hand'], ['👈', 'point left'], ['👉', 'point right'],
            ['👆', 'point up'], ['👇', 'point down'], ['☝️', 'index pointing up'], ['👍', 'thumbs up'],
            ['👎', 'thumbs down'], ['✊', 'raised fist'], ['👊', 'oncoming fist'], ['👏', 'clapping hands'],
            ['🙌', 'raising hands'], ['🫶', 'heart hands'], ['👐', 'open hands'], ['🤝', 'handshake'],
            ['🙏', 'folded hands'], ['💪', 'flexed biceps'], ['👀', 'eyes'], ['👂', 'ear'],
            ['🧠', 'brain'], ['🗣️', 'speaking head'], ['👤', 'person silhouette'], ['👥', 'people silhouettes'],
            ['🧑‍🚒', 'firefighter'], ['👮', 'police officer'], ['🧑‍⚕️', 'health worker'], ['🧑‍💻', 'technologist']
        ]) },
    { id: 'nature', label: 'Animals & Nature', icon: '🌲', emoji: entries([
            ['🐶', 'dog'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit'], ['🦊', 'fox'],
            ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'],
            ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'], ['🐧', 'penguin'],
            ['🐦', 'bird'], ['🦅', 'eagle'], ['🦆', 'duck'], ['🦉', 'owl'], ['🐝', 'bee'], ['🦋', 'butterfly'],
            ['🐌', 'snail'], ['🐞', 'lady beetle'], ['🐟', 'fish'], ['🐬', 'dolphin'], ['🐾', 'paw prints'],
            ['🌲', 'evergreen tree'], ['🌳', 'deciduous tree'], ['🌴', 'palm tree'], ['🌵', 'cactus'],
            ['🌻', 'sunflower'], ['🌹', 'rose'], ['🍀', 'four leaf clover'], ['🍁', 'maple leaf'],
            ['🌎', 'earth americas'], ['🌙', 'crescent moon'], ['⭐', 'star'], ['🌈', 'rainbow']
        ]) },
    { id: 'food', label: 'Food & Drink', icon: '☕', emoji: entries([
            ['🍎', 'red apple'], ['🍊', 'tangerine'], ['🍋', 'lemon'], ['🍌', 'banana'], ['🍉', 'watermelon'],
            ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🫐', 'blueberries'], ['🍒', 'cherries'], ['🍑', 'peach'],
            ['🍍', 'pineapple'], ['🥑', 'avocado'], ['🍅', 'tomato'], ['🥕', 'carrot'], ['🌽', 'corn'],
            ['🌶️', 'hot pepper'], ['🥖', 'baguette bread'], ['🧀', 'cheese'], ['🥚', 'egg'], ['🥓', 'bacon'],
            ['🍔', 'hamburger'], ['🍟', 'french fries'], ['🍕', 'pizza'], ['🌭', 'hot dog'], ['🥪', 'sandwich'],
            ['🌮', 'taco'], ['🍿', 'popcorn'], ['🍩', 'doughnut'], ['🍪', 'cookie'], ['🎂', 'birthday cake'],
            ['🍫', 'chocolate'], ['☕', 'hot beverage coffee'], ['🍵', 'tea'], ['🥤', 'cup straw'],
            ['🧃', 'beverage box'], ['💧', 'water droplet']
        ]) },
    { id: 'activities', label: 'Activities', icon: '🎉', emoji: entries([
            ['⚽', 'soccer ball'], ['🏀', 'basketball'], ['🏈', 'american football'], ['⚾', 'baseball'],
            ['🥎', 'softball'], ['🎾', 'tennis'], ['🏐', 'volleyball'], ['🏉', 'rugby'], ['🥏', 'flying disc'],
            ['🎱', 'pool eight ball'], ['🏓', 'ping pong'], ['🏸', 'badminton'], ['🥅', 'goal net'],
            ['⛳', 'golf flag'], ['🎣', 'fishing pole'], ['🤿', 'diving mask'], ['🎿', 'skis'],
            ['🛷', 'sled'], ['🎯', 'bullseye'], ['🪁', 'kite'], ['🎮', 'video game'], ['🎲', 'game die'],
            ['🧩', 'puzzle'], ['♟️', 'chess pawn'], ['🎨', 'artist palette'], ['🎭', 'performing arts'],
            ['🎤', 'microphone music'], ['🎧', 'headphones'], ['🎸', 'guitar'], ['🥁', 'drum'],
            ['🏆', 'trophy'], ['🥇', 'gold medal'], ['🎉', 'party popper'], ['🎊', 'confetti ball']
        ]) },
    { id: 'travel', label: 'Travel & Places', icon: '🚗', emoji: entries([
            ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'], ['🚎', 'trolleybus'], ['🏎️', 'racing car'],
            ['🚓', 'police car'], ['🚑', 'ambulance'], ['🚒', 'fire engine'], ['🚐', 'minibus'],
            ['🛻', 'pickup truck'], ['🚚', 'delivery truck'], ['🚜', 'tractor'], ['🏍️', 'motorcycle'],
            ['🚲', 'bicycle'], ['✈️', 'airplane'], ['🚁', 'helicopter'], ['🚀', 'rocket'], ['🛰️', 'satellite'],
            ['🚢', 'ship'], ['⛵', 'sailboat'], ['🚉', 'station'], ['⛽', 'fuel pump'], ['🚦', 'traffic light'],
            ['🗺️', 'world map'], ['🧭', 'compass'], ['🏕️', 'camping'], ['🏠', 'house'], ['🏥', 'hospital'],
            ['🏫', 'school'], ['🏢', 'office building'], ['⛰️', 'mountain'], ['🏖️', 'beach'],
            ['🌅', 'sunrise'], ['🌇', 'sunset city'], ['🌃', 'night city']
        ]) },
    { id: 'objects', label: 'Objects', icon: '📻', emoji: entries([
            ['📻', 'radio'], ['🎙️', 'studio microphone'], ['🎤', 'microphone'], ['📡', 'satellite antenna'],
            ['🛰️', 'satellite'], ['📞', 'telephone receiver'], ['☎️', 'telephone'], ['📱', 'mobile phone'],
            ['💻', 'laptop computer'], ['🖥️', 'desktop computer'], ['⌨️', 'keyboard'], ['🖨️', 'printer'],
            ['📷', 'camera'], ['🔦', 'flashlight'], ['🔋', 'battery'], ['🪫', 'low battery'], ['🔌', 'electric plug'],
            ['💡', 'light bulb'], ['🧯', 'fire extinguisher'], ['🩹', 'adhesive bandage'], ['🩺', 'stethoscope'],
            ['💊', 'pill'], ['🧰', 'toolbox'], ['🔧', 'wrench'], ['🔨', 'hammer'], ['🪛', 'screwdriver'],
            ['🔑', 'key'], ['🔒', 'locked'], ['🔓', 'unlocked'], ['📌', 'pushpin'], ['📍', 'round pushpin'],
            ['📋', 'clipboard'], ['📝', 'memo'], ['📅', 'calendar'], ['⏰', 'alarm clock'],
            ['⏱️', 'stopwatch'], ['🕐', 'one oclock'], ['🛜', 'wireless wifi'], ['⚙️', 'gear']
        ]) },
    { id: 'symbols', label: 'Symbols', icon: '✅', emoji: entries([
            ['✅', 'check mark button'], ['☑️', 'check box'], ['❌', 'cross mark'], ['❎', 'cross mark button'],
            ['⚠️', 'warning'], ['🚨', 'emergency siren'], ['ℹ️', 'information'], ['🆘', 'sos emergency'],
            ['🔥', 'fire'], ['⚡', 'high voltage'], ['☀️', 'sunny'], ['🌤️', 'partly cloudy'],
            ['☁️', 'cloud'], ['🌧️', 'rain'], ['⛈️', 'thunderstorm'], ['🌪️', 'tornado'], ['❄️', 'snowflake'],
            ['🌡️', 'thermometer'], ['♻️', 'recycle'], ['➕', 'plus'], ['➖', 'minus'], ['✖️', 'multiply'],
            ['➗', 'divide'], ['➡️', 'right arrow'], ['⬅️', 'left arrow'], ['⬆️', 'up arrow'], ['⬇️', 'down arrow'],
            ['↗️', 'up right arrow'], ['↘️', 'down right arrow'], ['🔴', 'red circle'], ['🟠', 'orange circle'],
            ['🟡', 'yellow circle'], ['🟢', 'green circle'], ['🔵', 'blue circle'], ['⚫', 'black circle'],
            ['1️⃣', 'keycap one'], ['2️⃣', 'keycap two'], ['3️⃣', 'keycap three'], ['#️⃣', 'keycap hash'],
            ['*️⃣', 'keycap asterisk'], ['🆗', 'ok button'], ['🆕', 'new button'], ['🔔', 'bell']
        ]) },
    { id: 'flags', label: 'Flags', icon: '🏁', emoji: entries([
            ['🏁', 'chequered flag'], ['🚩', 'triangular flag'], ['🎌', 'crossed flags'], ['🏳️', 'white flag'],
            ['🏴', 'black flag'], ['🇺🇸', 'flag united states'], ['🇨🇦', 'flag canada'], ['🇲🇽', 'flag mexico'],
            ['🇧🇷', 'flag brazil'], ['🇬🇧', 'flag united kingdom'], ['🇮🇪', 'flag ireland'], ['🇫🇷', 'flag france'],
            ['🇩🇪', 'flag germany'], ['🇮🇹', 'flag italy'], ['🇪🇸', 'flag spain'], ['🇵🇹', 'flag portugal'],
            ['🇳🇱', 'flag netherlands'], ['🇧🇪', 'flag belgium'], ['🇨🇭', 'flag switzerland'], ['🇸🇪', 'flag sweden'],
            ['🇳🇴', 'flag norway'], ['🇩🇰', 'flag denmark'], ['🇫🇮', 'flag finland'], ['🇵🇱', 'flag poland'],
            ['🇺🇦', 'flag ukraine'], ['🇯🇵', 'flag japan'], ['🇰🇷', 'flag south korea'], ['🇨🇳', 'flag china'],
            ['🇮🇳', 'flag india'], ['🇦🇺', 'flag australia'], ['🇳🇿', 'flag new zealand'], ['🇿🇦', 'flag south africa']
        ]) }
];
export const filterChatEmoji = (categoryId, query) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const categories = normalizedQuery
        ? CHAT_EMOJI_CATEGORIES
        : CHAT_EMOJI_CATEGORIES.filter(category => category.id === categoryId);
    return categories.flatMap(category => category.emoji)
        .filter(entry => !normalizedQuery || entry.name.includes(normalizedQuery) || entry.emoji === normalizedQuery);
};
export const insertChatEmoji = (value, selectionStart, selectionEnd, emoji) => ({
    value: `${value.slice(0, selectionStart)}${emoji}${value.slice(selectionEnd)}`,
    caret: selectionStart + emoji.length
});
//# sourceMappingURL=chatEmoji.js.map