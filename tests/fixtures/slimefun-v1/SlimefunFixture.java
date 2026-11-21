// Syntax fixtures only: the parser never resolves or executes these classes.
package io.github.thebusybiscuit.slimefun4.implementation.items;

class SlimefunItems {
    static final SlimefunItemStack TIN_CAN = new SlimefunItemStack("CAN", Material.IRON_INGOT, "&fTin Can");
    static final SlimefunItemStack CHAIN = new SlimefunItemStack("CHAIN", Material.STRING, "&bChain");
    static final SlimefunItemStack IRON_DUST = new SlimefunItemStack("IRON_DUST", Material.SUGAR, "Iron Dust");
    static final SlimefunItemStack ALLOY = new SlimefunItemStack("ALLOY", Material.IRON_INGOT, "Alloy");
    static final SlimefunItemStack SMELTERY = new SlimefunItemStack("SMELTERY", Material.FURNACE, "Smeltery");
    static final SlimefunItemStack POTION = new SlimefunItemStack("POTION", Color.RED, new PotionEffect(), "Tin Can");
    static final SlimefunItemStack UNKNOWN_AMOUNT = new SlimefunItemStack("UNKNOWN_AMOUNT", makeStack());
    static final SlimefunItemStack PORTABLE = new SlimefunItemStack("PORTABLE", Material.CRAFTING_TABLE, "Portable");
    static final SlimefunItemStack EAGER = new SlimefunItemStack("EAGER", Material.CRAFTING_TABLE, "Eager");
}
class Aliases {
    static final SlimefunItemStack POTION = SlimefunItems.POTION;
}
class RecipeType {
    static final RecipeType SMELTERY = new RecipeType(new NamespacedKey(plugin, "smeltery"), SlimefunItems.SMELTERY);
    static final RecipeType NULL = new RecipeType();
    static final RecipeType HEATED_PRESSURE_CHAMBER = new RecipeType(new NamespacedKey(plugin, "heated_pressure_chamber"), SlimefunItems.SMELTERY);
}
class SlimefunItem {
    SlimefunItem(ItemGroup group, SlimefunItemStack item, RecipeType recipeType, ItemStack[] recipe) { this(group,item,recipeType,recipe,null); }
    SlimefunItem(ItemGroup group, SlimefunItemStack item, RecipeType recipeType, ItemStack[] recipe, ItemStack recipeOutput) {}
    SlimefunItem(ItemGroup group, ItemStack item, String id, RecipeType recipeType, ItemStack[] recipe) {}
    public void preRegister() {}
}
class AlloyIngot extends SlimefunItem {
    AlloyIngot(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group,item,RecipeType.SMELTERY,recipe);
    }
}
class DynamicItem extends SlimefunItem {
    DynamicItem(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group,item,RecipeType.SMELTERY,recipe);
        setRecipeOutput(dynamicOutput());
    }
}
abstract class SimpleSlimefunItem extends SlimefunItem {
    SimpleSlimefunItem(ItemGroup group, SlimefunItemStack item, RecipeType type, ItemStack[] recipe) {
        super(group, item, type, recipe);
    }
    public void preRegister() { addItemHandler(getItemHandler()); }
    public abstract ItemUseHandler getItemHandler();
}
class PortableFixture extends SimpleSlimefunItem {
    PortableFixture(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group, item, RecipeType.SMELTERY, recipe);
    }
    public ItemUseHandler getItemHandler() { return event -> openInventory(event); }
}
class EagerHandlerFixture extends SimpleSlimefunItem {
    EagerHandlerFixture(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group, item, RecipeType.SMELTERY, recipe);
    }
    public ItemUseHandler getItemHandler() {
        setRecipeOutput(dynamicOutput());
        return event -> openInventory(event);
    }
}
class PlacementFixture extends SimpleSlimefunItem {
    PlacementFixture(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group, item, RecipeType.SMELTERY, recipe);
    }
    public BlockPlaceHandler getItemHandler() {
        return new BlockPlaceHandler(false) { public void onPlayerPlace(BlockPlaceEvent event) {} };
    }
}
class DelegatedItem extends SlimefunItem {
    DelegatedItem(ItemGroup group, SlimefunItemStack item) { this(group, item, 2); }
    DelegatedItem(ItemGroup group, SlimefunItemStack item, int count) { this(group, item, new ItemStack(Material.IRON_INGOT, count)); }
    DelegatedItem(ItemGroup group, SlimefunItemStack item, ItemStack input) {
        super(group, item, RecipeType.SMELTERY, new ItemStack[]{ input });
    }
}
class CycleItem extends SlimefunItem {
    CycleItem(ItemGroup group, SlimefunItemStack item) { this(group, item, 2); }
    CycleItem(ItemGroup group, SlimefunItemStack item, int count) { this(group, item); }
}
class AmbiguousItem extends SlimefunItem {
    AmbiguousItem(String value) { super(groups.resources, SlimefunItems.TIN_CAN, RecipeType.NULL, null); }
    AmbiguousItem(ItemStack value) { super(groups.resources, SlimefunItems.TIN_CAN, RecipeType.NULL, null); }
}
class SlimefunItemSetup {
    void setup(Object plugin) {
        new SlimefunItem(groups.resources, SlimefunItems.TIN_CAN, RecipeType.SMELTERY,
            new ItemStack[] { new ItemStack(Material.IRON_INGOT,4), null, SlimefunItems.IRON_DUST.item(),
                null, null, null, null, null, null }).register(plugin);
        new SlimefunItem(groups.resources, SlimefunItems.CHAIN, RecipeType.SMELTERY,
            new ItemStack[] { new ItemStack(Material.IRON_INGOT), null, null, null, null, null, null, null, null },
            new SlimefunItemStack(SlimefunItems.CHAIN,8).item()).register(plugin);
        new AlloyIngot(groups.resources, SlimefunItems.ALLOY,
            new ItemStack[] { SlimefunItems.IRON_DUST.item(), SlimefunItems.IRON_DUST.item(), null }).register(plugin);
        new DynamicItem(groups.resources, SlimefunItems.ALLOY,
            new ItemStack[] { new ItemStack(Material.IRON_INGOT) }).register(plugin);
        if (plugin != null) new SlimefunItem(groups.resources, SlimefunItems.TIN_CAN, RecipeType.SMELTERY,
            new ItemStack[] { new ItemStack(Material.IRON_INGOT) }).register(plugin);
        new DelegatedItem(groups.resources, SlimefunItems.POTION).register(plugin);
        new DelegatedItem(groups.resources, Aliases.POTION).register(plugin);
        new CycleItem(groups.resources, SlimefunItems.POTION).register(plugin);
        new AmbiguousItem(null).register(plugin);
        new SlimefunItem(groups.resources, new ItemStack(Material.IRON_INGOT, 3), "LEGACY_ID", RecipeType.SMELTERY,
            new ItemStack[]{ new ItemStack(Material.GOLD_INGOT) }).register(plugin);
        new SlimefunItem(groups.resources, SlimefunItems.UNKNOWN_AMOUNT, RecipeType.SMELTERY,
            new ItemStack[]{ new ItemStack(Material.IRON_INGOT) }).register(plugin);
        new SlimefunItem(groups.resources, SlimefunItems.TIN_CAN, RecipeType.SMELTERY,
            new ItemStack[]{ new ItemStack(Material.GOLD_INGOT) }).register(plugin);
        new SlimefunItem(groups.resources, new SlimefunItemStack("DIRECT_ID", Material.IRON_INGOT, "Direct"), RecipeType.NULL,
            new ItemStack[]{}).register(plugin);
        new SlimefunItem(groups.resources, new SlimefunItemStack("PLASTIC_SHEET", Material.PAPER, "Plastic Sheet"),
            RecipeType.HEATED_PRESSURE_CHAMBER, new ItemStack[]{ SlimefunItems.TIN_CAN.item() }).register(plugin);
        new PortableFixture(groups.resources, SlimefunItems.PORTABLE,
            new ItemStack[]{ new ItemStack(Material.IRON_INGOT, 2) }).register(plugin);
        new EagerHandlerFixture(groups.resources, SlimefunItems.EAGER,
            new ItemStack[]{ new ItemStack(Material.IRON_INGOT, 2) }).register(plugin);
        new PlacementFixture(groups.resources, new SlimefunItemStack("PLACEMENT", Material.STONE, "Placement"),
            new ItemStack[]{ new ItemStack(Material.IRON_INGOT) }).register(plugin);
    }
}
