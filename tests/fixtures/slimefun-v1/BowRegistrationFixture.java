// Models the pinned SlimefunBow preRegister chain without Bukkit dependencies.
package io.github.thebusybiscuit.slimefun4.implementation.items.weapons;

abstract class SlimefunBow extends SlimefunItem {
    SlimefunBow(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group, item, RecipeType.SMELTERY, recipe);
    }
    public void preRegister() {
        super.preRegister();
        addItemHandler(onShoot());
    }
    public abstract BowShootHandler onShoot();
}
class BowRegistrationFixture extends SlimefunBow {
    BowRegistrationFixture(ItemGroup group, SlimefunItemStack item, ItemStack[] recipe) {
        super(group, item, recipe);
    }
    public BowShootHandler onShoot() { return (event, target) -> {}; }
    static void setup(Object plugin) {
        new BowRegistrationFixture(groups.tools, new SlimefunItemStack("BOW_FIXTURE", Material.BOW, "Bow"),
            new ItemStack[] { new ItemStack(Material.STICK) }).register(plugin);
    }
}
