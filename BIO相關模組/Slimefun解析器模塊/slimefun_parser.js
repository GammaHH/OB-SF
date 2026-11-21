const { createHash } = require('node:crypto');
const PINNED_COMMIT = '5374034c8713248909e60e6855c6f745fd7ca676';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shortType = value => String(value).split('.').at(-1).replace(/<.*>/, '');
const cleanName = value => String(value).replace(/&[0-9a-fk-or]/gi, '').trim();
const primitives = new Set(['boolean', 'byte', 'short', 'char', 'int', 'long', 'float', 'double']);
const apiTypes = ['ItemStack', 'SlimefunItemStack', 'RecipeType', 'String', 'Material', 'HeadTexture', 'Color', 'ItemGroup'];
const primitiveWidening = { byte: ['short', 'int', 'long', 'float', 'double'], short: ['int', 'long', 'float', 'double'],
    char: ['int', 'long', 'float', 'double'], int: ['long', 'float', 'double'], long: ['float', 'double'], float: ['double'] };
// Verified in the pinned consumer implementations. Keep layout unknown in the
// shared schema until the complete recipe, including special handling, is validated.
const slotSemantics = {
    ENHANCED_CRAFTING_TABLE: { kind: 'POSITIONAL_3X3', className: 'EnhancedCraftingTable', line: 76 },
    SMELTERY: { kind: 'INVENTORY_SEARCH', className: 'AbstractSmeltery', line: 74 },
    ANCIENT_ALTAR: { kind: 'ALTAR_CALLBACK', className: 'RecipeType', line: 51 },
};
const requiresMachineRecipe = new Set(['GOLD_PAN', 'ORE_WASHER', 'REFINERY', 'HEATED_PRESSURE_CHAMBER',
    'FOOD_FABRICATOR', 'FOOD_COMPOSTER', 'FREEZER', 'GEO_MINER', 'NUCLEAR_REACTOR', 'MULTIBLOCK', 'INTERACT']);
const implementationItems = 'io.github.thebusybiscuit.slimefun4.implementation.items';
const supportedUseHandlers = new Set(['ItemUseHandler', 'ItemConsumptionHandler', 'BlockUseHandler',
    'ToolUseHandler', 'BlockPlaceHandler']);
function normalizeSlimefunAST(ast, source) {
    if (ast?.schema !== 'OB-SF Java AST V1') throw new Error('不支援的 Java AST schema');
    if (source?.commit !== PINNED_COMMIT || source.repository !== 'Slimefun/Slimefun4') throw new Error('Slimefun V1 來源未鎖定指定 commit');
    const classes = new Map(), diagnostics = [...(ast.diagnostics || [])], definitions = new Map(), resolving = new Set();
    for (const cls of ast.classes) {
        if (classes.has(cls.name)) { classes.set(cls.name, null); continue; }
        classes.set(cls.name, cls);
    }
    for (const required of ['SlimefunItems','SlimefunItem','RecipeType']) if (!classes.get(required))
        diagnostics.push({ status:'ERROR', code:'SOURCE_CORE_MISSING', message:'缺少或有歧義的核心類別：'+required });
    if (!ast.registrations.length) diagnostics.push({ status:'ERROR', code:'NO_REGISTRATIONS', message:'來源中沒有找到任何 register 呼叫，請確認來源目錄' });
    const itemFields = new Map((classes.get('SlimefunItems')?.fields || []).filter(field=>shortType(field.type)==='SlimefunItemStack').map(field => [field.name, field]));
    function fail(message) { throw new Error(message); }
    function integer(value) {
        if (!Number.isSafeInteger(value) || value <= 0) fail('數量不是可確認的正整數');
        return value;
    }
    function evaluate(node, env = {}, owner = '', trail = []) {
        if (node == null) return null;
        if (trail.length > 30) fail('常數／表達式解析超過深度限制');
        const next = [...trail, node];
        if (node.kind === 'literal') return node.value;
        if (node.kind === 'cast') {
            const value = evaluate(node.value, env, owner, next);
            if (value === null || (shortType(node.type) === 'ItemStack' && value?.kind === 'item')) return value;
            fail('轉型的實際值未確認：' + node.type);
        }
        if (node.kind === 'ref') {
            owner = node.owner ?? owner;
            if (Object.hasOwn(env, node.name)) return evaluate(env[node.name], {}, owner, next);
            const parts = node.name.split('.'), member = parts.at(-1), cls = parts.length > 1 ? parts.at(-2) : owner;
            if (cls === 'Material') return { kind: 'item', id: 'minecraft:' + member.toLowerCase(), qty: 1 };
            if (cls === 'SlimefunItems' || (!parts.slice(0,-1).length && itemFields.has(member) && owner === 'SlimefunItems')) return definition(member);
            if (cls === 'RecipeType') return { kind: 'recipe-type', constant: member };
            const field = classes.get(cls)?.fields?.find(field => field.name === member && /static/.test(field.modifiers) && /final/.test(field.modifiers));
            if (field) return evaluate(field.value, {}, cls, next);
            fail('未解析參照：' + node.name);
        }
        if (node.kind === 'binary') {
            const left = evaluate(node.left, env, owner, next), right = evaluate(node.right, env, owner, next);
            if (node.operator === 'PLUS' && (typeof left === 'string' || typeof right === 'string')) return String(left) + String(right);
            if (typeof left !== 'number' || typeof right !== 'number') fail('非靜態數值運算');
            if (node.operator === 'PLUS') return left + right;
            if (node.operator === 'MULTIPLY') return left * right;
            if (node.operator === 'MINUS') return left - right;
            fail('不支援的運算：' + node.operator);
        }
        if (node.kind === 'array') {
            if (!node.values) fail('動態陣列或未提供 slots');
            return node.values.map(value => evaluate(value, env, owner, next));
        }
        if (node.kind === 'new') {
            if (node.anonymous) fail('匿名類別的行為未確認');
            const type = shortType(node.type), args = node.args;
            if (type === 'ItemStack' || type === 'SlimefunItemStack') {
                if (type === 'SlimefunItemStack' && expressionType(args[0], owner) === 'String') {
                    const id = canonicalId(evaluate(args[0], env, owner, next));
                    const base = args[1];
                    const baseType = expressionType(base, owner);
                    let qty = 1;
                    if (baseType === 'ItemStack') {
                        const value = evaluate(base, env, owner, next);
                        if (value?.kind !== 'item') fail('SlimefunItemStack 的底層 ItemStack 未確認');
                        qty = value.qty;
                    } else if (!['Material', 'HeadTexture', 'String'].includes(baseType) &&
                        !(baseType === 'Color' && expressionType(args[2], owner) === 'PotionEffect')) {
                        fail('SlimefunItemStack overload／預設數量未確認');
                    }
                    return { kind: 'item', id, qty: integer(qty) };
                }
                if (type === 'SlimefunItemStack' && (args.length !== 2 || expressionType(args[0], owner) !== 'SlimefunItemStack'))
                    fail('SlimefunItemStack overload／預設數量未確認');
                if (type === 'ItemStack' && args.length === 2 && expressionType(args[0], owner) !== 'Material')
                    fail('ItemStack 數量 overload 未確認');
                const item = evaluate(args[0], env, owner, next);
                if (item?.kind !== 'item') fail('ItemStack 來源不是可確認的物品');
                if (type === 'ItemStack' && !item.id.startsWith('minecraft:')) fail('ItemStack overload 無法確認');
                const qty = args.length === 1 ? item.qty : args.length === 2 ? integer(evaluate(args[1], env, owner, next)) : fail('不支援的 ItemStack overload');
                return { ...item, qty };
            }
            fail('不支援的材料建構子：' + type);
        }
        if (node.kind === 'call') {
            if (node.name === 'item' && node.args.length === 0 && expressionType(node.receiver, owner) === 'SlimefunItemStack')
                return evaluate(node.receiver, env, owner, next);
            if (node.name === 'getDisplayName' && node.args.length === 0) {
                const value = evaluate(node.receiver, env, owner, next);
                if (value?.name) return value.name;
            }
            fail('動態或不支援的方法：' + node.name);
        }
        fail('不支援的 Java 語法：' + (node.syntax || node.kind));
    }
    function definition(constant) {
        if (definitions.has(constant)) return definitions.get(constant);
        if (resolving.has(constant)) fail('物品定義循環：' + constant);
        const field = itemFields.get(constant);
        if (!field) fail('缺少 Slimefun 物品定義：' + constant);
        resolving.add(constant);
        try {
            const value = evaluate(field.value, {}, 'SlimefunItems');
            if (value?.kind !== 'item') fail('物品定義不是 ItemStack');
            const result = { ...value, name: stackName(field.value, 'SlimefunItems'), constant, source: field.source };
            definitions.set(constant, result);
            return result;
        } finally { resolving.delete(constant); }
    }
    function canonicalId(value) {
        if (typeof value !== 'string' || !/^[A-Z0-9_.-]+$/.test(value)) fail('Slimefun 實際 ID 無法確認');
        return 'slimefun:' + value;
    }
    function stackName(node, owner) {
        if (node?.kind !== 'new' || shortType(node.type) !== 'SlimefunItemStack') return null;
        const args = node.args;
        if (expressionType(args[0], owner) !== 'String') return null;
        const nameIndex = expressionType(args[1], owner) === 'Color' || expressionType(args[2], owner) === 'Color' ? 3 : 2;
        try {
            const label = evaluate(args[nameIndex], {}, owner);
            return typeof label === 'string' ? cleanName(label) || null : null;
        } catch { return null; }
    }
    function stackIdentity(node, owner, source, trail = []) {
        if (trail.length >= 16) fail('物品身分參照超過深度限制');
        if (node?.kind === 'ref') {
            const parts = node.name.split('.');
            const name = parts.pop();
            const fieldOwner = parts.at(-1) ?? node.owner ?? owner;
            const field = classes.get(fieldOwner)?.fields?.find(value => value.name === name &&
                /\bstatic\b/.test(value.modifiers) && /\bfinal\b/.test(value.modifiers));
            if (field && !trail.includes(field)) {
                const value = stackIdentity(field.value, fieldOwner, field.source, [...trail, field]);
                return { ...value, constant: fieldOwner === 'SlimefunItems' ? name : value.constant };
            }
        }
        if (node?.kind === 'new' && !node.anonymous && shortType(node.type) === 'SlimefunItemStack') {
            const firstType = expressionType(node.args[0], owner);
            if (firstType === 'String' && node.args.length >= 2)
                return { id: canonicalId(evaluate(node.args[0], {}, owner)), name: stackName(node, owner), source, basis: 'stack-id-argument' };
            if (firstType === 'SlimefunItemStack' && node.args.length === 2)
                return stackIdentity(node.args[0], owner, source, trail);
        }
        fail('註冊物品無法解析為 Slimefun 實際 ID');
    }
    for (const constant of itemFields.keys()) {
        try { definition(constant); }
        catch (error) {
            const field = itemFields.get(constant);
            let identity;
            try { identity = stackIdentity(field.value, 'SlimefunItems', field.source); } catch {}
            diagnostics.push({ status: 'REVIEW', code: 'ITEM_DEFINITION_UNRESOLVED', constant, identity,
                source: field.source, message: error.message });
        }
    }
    const recipeTypes = new Map();
    for (const field of classes.get('RecipeType')?.fields || []) {
        if (field.value?.kind !== 'new' || shortType(field.value.type) !== 'RecipeType') continue;
        let machineId = null;
        const display = field.value.args[1];
        const stack = display?.kind === 'call' && display.name === 'item' && display.args.length === 0 ? display.receiver : display;
        try { machineId = stackIdentity(stack, 'RecipeType', field.source).id; } catch {}
        recipeTypes.set(field.name, { constant: field.name, machineId, source: field.source });
    }
    function expressionType(node, owner, params = {}) {
        if (!node) return null;
        if (node.kind === 'new' || node.kind === 'cast') return shortType(node.type);
        if (node.kind === 'array' && node.type && node.type !== 'null') {
            return shortType(node.type) + '[]'.repeat(Math.max(1, node.dimensions?.length || 0));
        }
        if (node.kind === 'literal') {
            if (node.value === null) return '<null>';
            const types = { STRING_LITERAL: 'String', CHAR_LITERAL: 'char', INT_LITERAL: 'int', LONG_LITERAL: 'long',
                FLOAT_LITERAL: 'float', DOUBLE_LITERAL: 'double', BOOLEAN_LITERAL: 'boolean' };
            return types[node.literalType] || (typeof node.value === 'string' ? 'String' : null);
        }
        if (node.kind === 'call' && node.name === 'item' && !node.args.length &&
            expressionType(node.receiver, owner, params) === 'SlimefunItemStack') return 'ItemStack';
        if (node.kind !== 'ref') return null;
        if (Object.hasOwn(params, node.name)) return params[node.name];
        const parts = node.name.split('.');
        const member = parts.pop(), cls = parts.at(-1) ?? node.owner ?? owner;
        if (parts.length && ['Material', 'HeadTexture', 'Color'].includes(cls)) return cls;
        const field = classes.get(cls)?.fields?.find(value => value.name === member);
        return field ? shortType(field.type) : null;
    }
    function assignable(actual, expected) {
        if (!actual || actual === expected) return true;
        if (actual === '<null>') return !primitives.has(expected);
        if (primitives.has(actual) && primitives.has(expected)) return primitiveWidening[actual]?.includes(expected) || false;
        if ((primitives.has(actual) && (apiTypes.includes(expected) || expected.endsWith('[]'))) ||
            (primitives.has(expected) && (apiTypes.includes(actual) || actual.endsWith('[]')))) return false;
        if (expected === 'Object') return true;
        if (actual.endsWith('[]') && expected.endsWith('[]')) {
            const element = actual.slice(0, -2), target = expected.slice(0, -2);
            return primitives.has(element) || primitives.has(target) ? element === target : assignable(element, target);
        }
        const seen = new Set();
        let current = actual;
        while (classes.get(current)?.extends && !seen.has(current)) {
            seen.add(current);
            current = shortType(classes.get(current).extends);
            if (current === expected) return true;
        }
        // Only rule out provably incompatible types. Unknown library inheritance or
        // implemented interfaces must never break a tie in favor of another overload.
        if (apiTypes.includes(actual) && apiTypes.includes(expected))
            return actual === 'SlimefunItemStack' && expected === 'ItemStack';
        if (actual.endsWith('[]') && apiTypes.includes(expected)) return false;
        if (apiTypes.includes(actual) && expected.endsWith('[]')) return false;
        return true;
    }
    function substitute(node, env, owner, budget) {
        if (node == null || typeof node !== 'object') return node;
        if (--budget.nodes < 0) fail('建構子委派超過表達式工作量限制');
        if (node.kind === 'ref') return Object.hasOwn(env, node.name) ? env[node.name] : { ...node, owner };
        if (Array.isArray(node)) return node.map(value => substitute(value, env, owner, budget));
        return Object.fromEntries(Object.entries(node).map(([key,value]) => [key, substitute(value, env, owner, budget)]));
    }
    function constructor(node, owner, trail = [], argumentTypes = node?.args?.map(arg => expressionType(arg, owner)),
        budget = { nodes: 10000 }) {
        if (node?.kind !== 'new' || node.anonymous) fail('註冊對象不是受支援的靜態建構子');
        const type = shortType(node.type);
        if (trail.length >= 16) fail('建構子委派超過深度限制');
        const cls = classes.get(type);
        if (!cls) fail('缺少或有歧義的建構子類別：' + type);
        const overloads = cls.constructors.filter(({params}) => params.at(-1)?.varargs ?
            node.args.length >= params.length - 1 :
            params.length === node.args.length && params.every((param, index) => assignable(argumentTypes[index], shortType(param.type))));
        if (overloads.length !== 1) {
            const error = new Error('建構子 overload 無法唯一確認：' + type + '/' + node.args.length);
            error.constructorEvidence = { type, argumentTypes, chain: trail,
                signatures: cls.constructors.map(candidate => ({ params: candidate.params, source: candidate.source })) };
            throw error;
        }
        const ctor = overloads[0], env = Object.fromEntries(ctor.params.map((param,index) => [param.name, node.args[index]]));
        if (ctor.params.at(-1)?.varargs) fail('建構子 varargs 未確認：' + type);
        const types = ctor.params.map(param => shortType(param.type));
        const signature = type + '(' + types.join(', ') + ')';
        if (trail.some(step => step.signature === signature)) fail('建構子委派循環：' + signature);
        const chain = [...trail, { signature, source: ctor.source }];
        const inherited = chain.some(step => !step.signature.startsWith('SlimefunItem('));
        const resolvedFrom = inherited ? 'inherited-constructor' : 'direct-constructor';
        if (type === 'SlimefunItem') {
            if (types.join(',') === 'ItemGroup,SlimefunItemStack,RecipeType,ItemStack[],ItemStack') {
                return { group: node.args[0], item: node.args[1], recipeType: node.args[2], slots: node.args[3],
                    output: node.args[4], chain, resolvedFrom, blockers: [] };
            }
            if (types.join(',') === 'ItemGroup,ItemStack,String,RecipeType,ItemStack[]') {
                return { group: node.args[0], item: node.args[1], explicitId: node.args[2], recipeType: node.args[3],
                    slots: node.args[4], output: null, chain, resolvedFrom, blockers: [] };
            }
        }
        const call = ctor.body[0];
        if (call?.kind !== 'call' || call.receiver || !['super', 'this'].includes(call.name))
            fail('缺少可確認的建構子委派：' + signature);
        const params = Object.fromEntries(ctor.params.map((param,index) => [param.name, types[index]]));
        const args = call.args.map(arg => substitute(arg, env, type, budget));
        const delegatedTypes = call.args.map(arg => expressionType(arg, type, params));
        const resolved = constructor({ kind: 'new', type: call.name === 'this' ? type : cls.extends, args },
            type, chain, delegatedTypes, budget);
        if (type !== 'SlimefunItem' && cls.recipeOverrides?.includes('getId')) fail('子類別覆寫 getId，身分未確認：' + type);
        if (ctor.body.length > 1 || (type !== 'SlimefunItem' && cls.recipeOverrides?.length))
            resolved.blockers.push({ signature, source: ctor.source, overrides: cls.recipeOverrides, statements: ctor.body.slice(1) });
        return resolved;
    }
    function registrationKind(registration) {
        const { expression, owner, method, contexts } = registration;
        if (method === 'register' && expression?.kind === 'ref' && expression.name === 'super') return 'INTERNAL_DELEGATION';
        if ((owner === 'GEOResource' && method === 'register' && expression?.name === 'getResourceManager') ||
            (owner === 'SlimefunItem' && ((method === 'load' && expression?.name === 'recipeType') ||
                (method === 'onEnable' && expression?.name === 'itemGroup')))) return 'INTERNAL_API';
        if (contexts?.length) return 'CONDITIONAL';
        if (expression?.anonymous) return 'ANONYMOUS';
        if (expression?.kind === 'new') return 'CONSTRUCTOR';
        if (expression?.kind === 'call') {
            let receiver = expression.receiver;
            while (receiver?.kind === 'call') receiver = receiver.receiver;
            return receiver?.kind === 'new' ? 'FLUENT_RECEIVER' : 'CALL_RECEIVER';
        }
        if (expression?.kind === 'ref') return 'REFERENCE_RECEIVER';
        return 'OTHER_RECEIVER';
    }
    // Verified in the pinned API: addItemHandler installs callbacks. The callback
    // factory must itself be deferred before the hook can be treated this way.
    function handlerHookEvidence(blocker, chain) {
        if (blocker.statements.length || blocker.overrides?.length !== 1 || blocker.overrides[0] !== 'preRegister') return null;
        const owners = [...new Set(chain.map(step => step.signature.split('(')[0]))];
        const cls = classes.get(blocker.signature.split('(')[0]);
        const hook = cls?.handlerMethods?.preRegister;
        const simple = cls?.name === 'SimpleSlimefunItem' && cls.package === implementationItems;
        const bow = cls?.name === 'SlimefunBow' && cls.package === implementationItems + '.weapons';
        if (!hook || (!simple && !bow) || hook.body.length !== (bow ? 2 : 1)) return null;
        if (bow) {
            const parentCall = hook.body[0];
            if (parentCall.kind !== 'call' || parentCall.receiver?.kind !== 'ref' || parentCall.receiver.name !== 'super' ||
                parentCall.name !== 'preRegister' || parentCall.args.length ||
                shortType(cls.extends) !== 'SlimefunItem' || classes.get('SlimefunItem')?.handlerMethods?.preRegister?.body.length !== 0)
                return null;
        }
        const callbackName = bow ? 'onShoot' : 'getItemHandler';
        const add = hook.body.at(-1), callback = add.args?.[0];
        if (add.kind !== 'call' || add.name !== 'addItemHandler' || add.receiver || add.args.length !== 1 ||
            callback?.kind !== 'call' || callback.name !== callbackName || callback.receiver || callback.args.length) return null;
        const factory = owners.map(owner => classes.get(owner)?.handlerMethods?.[callbackName]).find(Boolean);
        const handlerType = factory?.type.replace(/^(?:@\w+\s+)+/, '');
        if (!factory?.deferred || (bow ? handlerType !== 'BowShootHandler' : !supportedUseHandlers.has(handlerType))) return null;
        return { hook: hook.source, callback: factory.source };
    }
    const items = new Map(), registrationKinds = {};
    let resolvedItemIds = 0;
    for (const registration of ast.registrations) {
        const kind = registrationKind(registration);
        registrationKinds[kind] = (registrationKinds[kind] || 0) + 1;
        const location = { ...source, ...registration.source };
        let identity = null, resolved, type, stage = 'RECEIVER';
        try {
            if (kind.startsWith('INTERNAL_')) {
                diagnostics.push({ status: 'SPECIAL', code: 'INTERNAL_REGISTRATION_CALL', kind, source: location,
                    expression: registration.expression, message: '內部 API／父類別註冊委派' });
                continue;
            }
            if (kind === 'CONDITIONAL') fail('條件／迴圈／Lambda 中的註冊未靜態展開：' + registration.contexts.join(', '));
            if (kind !== 'CONSTRUCTOR') fail('註冊接收者需人工解析：' + kind);
            if (registration.arguments && registration.arguments.length !== 1) fail('註冊呼叫的參數數量與 SlimefunItem API 不符');
            stage = 'CONSTRUCTOR';
            resolved = constructor(registration.expression, registration.owner);
            stage = 'ITEM_ID';
            identity = resolved.explicitId ?
                { id: canonicalId(evaluate(resolved.explicitId)), basis: 'constructor-id-argument', source: registration.source } :
                stackIdentity(resolved.item, '', registration.source);
            resolvedItemIds++;
            const itemId = identity.id;
            stage = 'RECIPE_TYPE';
            const recipeType = evaluate(resolved.recipeType);
            if (recipeType?.kind !== 'recipe-type') fail('RecipeType 未確認');
            type = recipeTypes.get(recipeType.constant);
            if (!type) fail('缺少 RecipeType 定義：' + recipeType.constant);
            stage = 'SUBCLASS_BEHAVIOR';
            const handlerHooks = resolved.blockers.map(blocker => handlerHookEvidence(blocker, resolved.chain));
            if (handlerHooks.includes(null)) fail('子類別建構或註冊行為待人工解析');
            stage = 'MACHINE_SEMANTICS';
            if (requiresMachineRecipe.has(recipeType.constant)) fail('需以設備實際執行或特殊取得規則核對材料與產量');
            stage = 'INGREDIENTS';
            const slots = evaluate(resolved.slots);
            if (!Array.isArray(slots)) fail('配方 slots 未確認');
            if (slots.some(value => value !== null && value?.kind !== 'item')) fail('存在無法確認的材料');
            stage = 'OUTPUT';
            const explicit = evaluate(resolved.output);
            if (explicit !== null && explicit?.kind !== 'item') fail('Recipe Output 未確認');
            const output = integer((explicit || evaluate(resolved.item))?.qty);
            if (explicit && explicit.id !== itemId) fail('明確 Recipe Output 與註冊物品不同，需特殊處理');
            const outputEvidence = { basis: explicit ? 'EXPLICIT' : 'PROVEN_DEFAULT', source: explicit ? registration.source : identity.source,
                expression: explicit ? resolved.output : resolved.item };
            const name = identity.name;
            const external = ['MOB_DROP','BARTER_DROP','NULL'].includes(recipeType.constant);
            stage = 'INGREDIENTS';
            const ingredients = [];
            for (const slot of slots.filter(Boolean)) {
                integer(slot.qty);
                const existing = ingredients.find(value => value.id === slot.id);
                if (existing) existing.qty = integer(existing.qty + slot.qty);
                else ingredients.push({ kind: 'item', id: slot.id, qty: slot.qty });
            }
            const warnings = external ? ['特殊取得資訊不可視為消耗材料；需人工解析取得語意'] :
                [!type?.machineId ? 'RecipeType 的 Machine 未確認' : '配方 layout 語意待人工確認；保留原始 slots'];
            const semantic = slotSemantics[recipeType.constant];
            const consumer = semantic && classes.get(semantic.className);
            const semantics = consumer ? { kind: semantic.kind, source: { file: consumer.source.file, line: semantic.line } } : null;
            if (semantics?.kind === 'POSITIONAL_3X3' && (slots.length !== 9 || slots.some(slot => slot && slot.qty !== 1)))
                warnings.push('九格比對與實際扣料量需核對；材料數量目前來自註冊 slots');
            const recipe = { sourceType: recipeType.constant, section: null, machineId: type?.machineId || null,
                recipeKind: external ? 'external' : 'registration', layout: 'unknown', output,
                ingredients: external ? [] : ingredients, slots, itemGroup: resolved.group,
                status: external ? 'SPECIAL' : 'REVIEW', warnings,
                source: location, resolvedFrom: resolved.resolvedFrom,
                provenance: { identity, constructors: resolved.chain, recipeType: type.source, output: outputEvidence, semantics,
                    handlerHooks: handlerHooks.length ? handlerHooks : undefined } };
            recipe.recipeId = 'recipe-' + hash({ itemId, sourceType: recipe.sourceType, output, ingredients: recipe.ingredients, slots }).slice(0,24);
            if (!items.has(itemId)) items.set(itemId, { id: itemId, actualId: itemId.slice('slimefun:'.length), name: name || null,
                javaConstant: identity.constant, recipes: [], warnings: name ? [] : ['缺少可確認的顯示名稱'] });
            const item = items.get(itemId);
            if (!item.name && name) Object.assign(item, { name, javaConstant: identity.constant, warnings: [] });
            const existing = item.recipes.find(value => value.recipeId === recipe.recipeId);
            if (existing) (existing.additionalSources ||= []).push(recipe.source);
            else item.recipes.push(recipe);
        } catch (error) {
            diagnostics.push({ status: identity ? 'REVIEW' : 'UNSUPPORTED', code: 'REGISTRATION_UNRESOLVED',
                itemId: identity?.id || null, identity, kind, stage, source: location, expression: registration.expression,
                constructors: resolved?.chain, constructorEvidence: error.constructorEvidence, recipeType: type?.constant, blockers: resolved?.blockers,
                rawSlots: resolved?.slots, outputEvidence: resolved ? { basis: 'UNRESOLVED', expression: resolved.output } : undefined,
                contexts: registration.contexts, message: error.message });
        }
    }
    const normalized = [...items.values()].sort((a,b) => a.id.localeCompare(b.id));
    const statuses = Object.fromEntries(['OK','OK_BRANCH','REVIEW','UNSUPPORTED','SPECIAL','ERROR'].map(status=>[status,
        normalized.flatMap(item=>item.recipes).filter(recipe=>recipe.status===status).length + diagnostics.filter(value=>value.status===status).length]));
    return { schema: 'OB-SF Normalized Recipe V1', schemaVersion: 1, adapter: 'slimefun-java-v1', provider_id: 'slimefun4', source,
        registryFingerprint: 'sha256:' + hash({ source, items: normalized }),
        itemDefinitions: [...definitions.values()], recipeTypes: [...recipeTypes.values()], items: normalized, diagnostics,
        registrationKinds,
        stats: { parsedJavaFiles: ast.files, registrations: ast.registrations.length, resolvedItemIds, items: normalized.length,
            recipes: normalized.reduce((sum,item) => sum + item.recipes.length,0), unresolved: diagnostics.length,
            missingItemIds: diagnostics.filter(value=>value.code==='REGISTRATION_UNRESOLVED'&&!value.itemId).length +
                diagnostics.filter(value=>value.code==='INTERNAL_REGISTRATION_CALL').length,
            missingNames: normalized.filter(item=>!item.name).length, multipleRecipes: normalized.filter(item=>item.recipes.length>1).length,
            missingRecipeTypes: diagnostics.filter(value=>value.stage === 'RECIPE_TYPE').length,
            unresolvedConstructors: diagnostics.filter(value=>value.stage === 'CONSTRUCTOR').length,
            unresolvedIngredients: diagnostics.filter(value=>value.stage === 'INGREDIENTS').length,
            internalRegistrationCalls: diagnostics.filter(value=>value.code === 'INTERNAL_REGISTRATION_CALL').length,
            syntaxErrors: ast.diagnostics?.length || 0,
            ...statuses } };
}
function renderManifest(registry) {
    const escape = value => String(value ?? '').replaceAll('|','\\|').replace(/[\r\n]/g,' ');
    const lines = ['# Slimefun Recipe Manifest', '', '- Source commit: `' + registry.source.commit + '`',
        '- Registry fingerprint: `' + registry.registryFingerprint + '`',
        ...Object.entries(registry.stats).map(([key,value]) => '- ' + key + ': ' + value), '',
        'Manifest 是審核入口；REVIEW／SPECIAL／UNSUPPORTED 不代表 Base，也不自動發布。', '',
        '| Item ID | Recipe ID | Status | RecipeType | Output | Output evidence | Source | Warning |', '|---|---|---|---|---|---|---|---|'];
    for (const item of registry.items) for (const recipe of item.recipes) lines.push('| ' +
        [item.id,recipe.recipeId,recipe.status,recipe.sourceType,recipe.output,recipe.provenance?.output.basis,recipe.source.file + ':' + recipe.source.line,recipe.warnings.join('；')].map(escape).join(' | ') + ' |');
    lines.push('', '## 未解析與語法診斷', '');
    for (const diagnostic of registry.diagnostics) lines.push('- [' + diagnostic.status + '] ' + escape(diagnostic.source?.file || diagnostic.file) + ':' +
        (diagnostic.source?.line || diagnostic.line || '') + ' · ' +
        [diagnostic.itemId, diagnostic.kind, diagnostic.stage, diagnostic.message].filter(Boolean).map(escape).join(' · '));
    return lines.join('\n') + '\n';
}
module.exports = { PINNED_COMMIT, normalizeSlimefunAST, renderManifest };
