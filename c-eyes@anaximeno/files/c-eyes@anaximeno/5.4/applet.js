/* applet.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
'use strict';

// NOTE: this is frozen on the 1.15.x versions, and might only receive patch updates

const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Gettext = imports.gettext;
const Util = imports.misc.util;

const SignalManager = imports.misc.signalManager;
const { Atspi, GLib, Gio, St, Clutter } = imports.gi;

const { EyeModeFactory } = require("./eyeModes.js");
const { ClickAnimationModeFactory } = require("./clickAnimationModes.js");
const { Debouncer } = require("./helper.js");

const CLICK_DEBOUNCE_INTERVAL = 2;
const EYE_AREA_WIDTH = 28;
const EYE_AREA_HEIGHT = 16;

// NOTE: must keep in sync with metadata.uuid
const UUID = "c-eyes@anaximeno";

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(text) {
	let locText = Gettext.dgettext(UUID, text);

	if (locText == text) {
		locText = window._(text);
	}

	return locText;
}

const UPDATE_CHANGE_MSG = _(
	"📢 The click effects will be removed from this applet on the version 6.2 of Cinnamon\n" +
	"and moved to a new extension named mouse-click-effects which can already be installed\n" +
	"on the Cinnamon Extensions settings module for versions of Cinnamon >= 5.4"
);

class Eye extends Applet.Applet {
	_get_icon_cached(dir, mode, click_type, color) {
		let key = `${dir}${mode}${click_type}${color}`;
		let path = `${dir}/icons/${mode}_${click_type}_${color}.svg`;

		if (this._file_mem_cache[key]) {
			return this._file_mem_cache[key];
		} else if (GLib.file_test(path, GLib.FileTest.IS_REGULAR)) {
			this._file_mem_cache[key] = Gio.icon_new_for_string(path);
			return this._file_mem_cache[key];
		} else {
			return null;
		}
	}

	_init_data_dir() {
		let data_dir = `${GLib.get_user_cache_dir()}/${this.metadata.uuid}`;

		if (GLib.mkdir_with_parents(`${data_dir}/icons`, 0o777) < 0)
			throw new Error(`Failed to create cache dir at ${data_dir}`);

		return data_dir;
	}

	_setup_settings(uuid, instanceId) {
		this.settings = new Settings.AppletSettings(this, uuid, instanceId);
		const settingsDebouncer = new Debouncer();

		const _settings = [
			{
				key: "eye-repaint-interval",
				value: "eye_repaint_interval",
				cb: settingsDebouncer.debounce((e) => this.set_active(true), 300),
			},
			{
				key: "eye-repaint-angle",
				value: "eye_repaint_angle",
				cb: null,
			},
			{
				key: "fade-timeout",
				value: "fade_timeout",
				cb: settingsDebouncer.debounce((e) => this.on_property_updated(e), 300),
			},
			{
				key: "eye-mode",
				value: "eye_mode",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-click-mode",
				value: "mouse_click_mode",
				cb: this.on_property_updated,
			},
			{
				key: "eye-line-width",
				value: "eye_line_width",
				cb: settingsDebouncer.debounce((e) => this.on_property_updated(e), 300),
			},
			{
				key: "eye-margin",
				value: "eye_margin",
				cb: settingsDebouncer.debounce((e) => this.on_property_updated(e), 300),
			},
			{
				key: "eye-clicked-color",
				value: "eye_clicked_color",
				cb: this.on_property_updated,
			},
			{
				key: "iris-clicked-color",
				value: "iris_clicked_color",
				cb: this.on_property_updated,
			},
			{
				key: "pupil-clicked-color",
				value: "pupil_clicked_color",
				cb: this.on_property_updated,
			},
			{
				key: "fill-lids-color-painting",
				value: "fill_lids_color_painting",
				cb: this.on_property_updated
			},
			{
				key: "fill-bulb-color-painting",
				value: "fill_bulb_color_painting",
				cb: this.on_property_updated
			},
			{
				key: "mouse-click-image-size",
				value: "mouse_click_image_size",
				cb: settingsDebouncer.debounce((e) => this.on_property_updated(e), 300),
			},
			{
				key: "mouse-click-enable",
				value: "mouse_click_enable",
				cb: this.on_mouse_click_enable_updated,
			},
			{
				key: "mouse-left-click-enable",
				value: "mouse_left_click_enable",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-right-click-enable",
				value: "mouse_right_click_enable",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-middle-click-enable",
				value: "mouse_middle_click_enable",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-left-click-color",
				value: "mouse_left_click_color",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-middle-click-color",
				value: "mouse_middle_click_color",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-right-click-color",
				value: "mouse_right_click_color",
				cb: this.on_property_updated,
			},
			{
				key: "mouse-click-opacity",
				value: "mouse_click_opacity",
				cb: settingsDebouncer.debounce((e) => this.on_property_updated(e), 300),
			},
			{
				key: "click-animation-mode",
				value: "click_animation_mode",
				cb: null,
			},
			{
				key: "eye-activate-by-default",
				value: "eye_activate_by_default",
				cb: this.on_eye_activated_by_default_updated,
			},
			{
				key: "deactivate-on-fullscreen",
				value: "deactivate_on_fullscreen",
				cb: this.on_fullscreen_changed.bind(this),
			},
			{
				key: "eye-vertical-padding",
				value: "eye_vertical_padding",
				cb: settingsDebouncer.debounce(
					(e) => this.on_property_updated(e,
						{ eye_property_update: true, mouse_property_update: false }), 300),
			},
			{
				key: "deactivate-effects-on-fullscreen",
				value: "deactivate_effects_on_fullscreen",
				cb: this.on_fullscreen_changed.bind(this),
			}
		];

		_settings.forEach(
			s => this.settings.bind(s.key, s.value, s.cb ? (...args) => s.cb.call(this, ...args) : null)
		);
	}

	constructor(metadata, orientation, panelHeight, instanceId) {
		super(orientation, panelHeight, instanceId);

		this.setAllowedLayout(Applet.AllowedLayout.BOTH);
		this._setup_settings(metadata.uuid, instanceId);

		this.metadata = metadata;
		this.data_dir = this._init_data_dir();
		this.img_dir = `${metadata.path}/../circle`;

		this.area = new St.DrawingArea();
		this.actor.add(this.area);

		this.signals = new SignalManager.SignalManager(null);
		this.signals.connect(global.screen, 'in-fullscreen-changed', this.on_fullscreen_changed, this);
		this.signals.connect(global.screen, 'workspace-switched', () => {
			// If the eye is refreshed exactly during the workspace switch process it's possible that the position
			// of the panel is not correctly accessed, so the position of the eye cannot be estimated correctly,
			// resulting in the eye looking at the wrong direction, to avoid that we will give it some timeout and
			// wait first for the switch process to complete.
			Util.setTimeout(() => this.area.queue_repaint(), 400);
		}, this);

		Atspi.init();

		this._mouseListener = Atspi.EventListener.new(this._mouse_click_event.bind(this));

		this._file_mem_cache = {};
		this._last_mouse_x = undefined;
		this._last_mouse_y = undefined;

		this.eye_activated = this.eye_activate_by_default;

		this.click_debounced = (new Debouncer()).debounce(this._click_animation.bind(this), CLICK_DEBOUNCE_INTERVAL);

		this.set_active(true);
		this.set_mouse_circle_property_update(false);
		this.set_mouse_circle_active(this.mouse_click_show);
		this.update_tooltip();
	}

	get mouse_click_show() {
		return this.mouse_click_enable && this.eye_activated;
	}

	on_applet_removed_from_panel(deleteConfig) {
		this.destroy();
	}

	on_applet_clicked(event) {
		this.eye_activated = !this.eye_activated;

		if (this.mouse_click_enable) {
			this.set_mouse_circle_active(this.mouse_click_show);
		}

		this.area.queue_repaint();
		this.update_tooltip();
	}

	on_property_updated(event, opts = { mouse_property_update: true, eye_property_update: true }) {
		if (opts.mouse_property_update)
			this.set_mouse_circle_property_update(true);
		if (opts.eye_property_update)
			this.set_eye_property_update();
		this.update_tooltip();
	}

	on_mouse_click_enable_updated(event) {
		this.on_property_updated(event);
		this.set_mouse_circle_active(this.mouse_click_show);
		this.area.queue_repaint();
	}

	on_eye_activated_by_default_updated(event) {
		this.on_property_updated(event);

		if (this.eye_activate_by_default) {
			this.eye_activated = this.eye_activate_by_default;
			this.set_mouse_circle_active(this.mouse_click_show);
			this.area.queue_repaint();
		}
	}

	on_fullscreen_changed() {
		const monitor = global.screen.get_current_monitor();
		const monitorIsInFullscreen = global.screen.get_monitor_in_fullscreen(monitor);
		const panelsInMonitor = Main.panelManager.getPanelsInMonitor(monitor);

		let panelIsInCurrentMonitor = false;
		if (panelsInMonitor !== null && panelsInMonitor !== undefined) {
			panelIsInCurrentMonitor = panelsInMonitor.includes(this.panel);
		}

		if (this.deactivate_on_fullscreen && panelIsInCurrentMonitor) {
			this.set_active(!monitorIsInFullscreen);
		} else {
			this.set_active(true);
		}

		if (this.deactivate_effects_on_fullscreen) {
			this.set_mouse_circle_active(!monitorIsInFullscreen && this.mouse_click_show);
		} else {
			this.set_mouse_circle_active(this.mouse_click_show);
		}
	}

	destroy() {
		this.signals.disconnectAllSignals();
		this.set_mouse_circle_active(false);
		this.set_active(false);
		this.area.destroy();
		this.settings.finalize();
	}

	set_active(enabled) {
		this.set_eye_property_update();

		if (this._eye_update_handler) {
			Mainloop.source_remove(this._eye_update_handler);
			this._eye_update_handler = null;
		}

		this.signals.disconnect('repaint', this.area);

		if (enabled) {
			this.signals.connect(this.area, 'repaint', this._eye_draw, this);

			this._eye_update_handler = Mainloop.timeout_add(
				this.eye_repaint_interval, this._eye_timeout.bind(this)
			);

			this.area.queue_repaint();
		}
	}

	set_mouse_circle_property_update(checkCache = true) {
		if (checkCache == false) this._file_mem_cache = {};
		this._mouse_circle_create_data_icon('left_click', this.mouse_left_click_color, checkCache);
		this._mouse_circle_create_data_icon('right_click', this.mouse_right_click_color, checkCache);
		this._mouse_circle_create_data_icon('middle_click', this.mouse_middle_click_color, checkCache);
	}

	set_eye_property_update() {
		this.area.set_width((EYE_AREA_WIDTH + 2 * this.eye_margin) * global.ui_scale);
		this.area.set_height(EYE_AREA_HEIGHT * global.ui_scale);
		this.area.queue_repaint();
	}

	set_mouse_circle_active(enabled) {
		if (enabled == null) {
			enabled = this.mouse_click_show;
		}

		this._mouseListener.deregister('mouse');

		if (enabled) {
			this.set_mouse_circle_property_update(true);
			this._mouseListener.register('mouse');
		}
	}

	update_tooltip() {
		let message = _("")
		let tip = this.eye_activated ? _("click to deactivate the eye") : _("click to activate the eye");
		this.set_applet_tooltip(`<b>${_('TIP')}:</b> ` + tip + "\n" + UPDATE_CHANGE_MSG, true);
	}

	_mouse_circle_create_data_icon(name, color, checkCache) {
		if (checkCache && this._get_icon_cached(this.data_dir, this.mouse_click_mode, name, color))
			return;

		let source = Gio.File.new_for_path(`${this.img_dir}/${this.mouse_click_mode}.svg`);
		let [l_success, contents] = source.load_contents(null);
		contents = imports.byteArray.toString(contents);

		// Replace to new color
		contents = contents.replace('fill="#000000"', `fill="${color}"`);

		// Save content to cache dir
		let dest = Gio.File.new_for_path(`${this.data_dir}/icons/${this.mouse_click_mode}_${name}_${color}.svg`);

		if (!dest.query_exists(null)) {
			dest.create(Gio.FileCreateFlags.NONE, null);
		}

		let [r_success, tag] = dest.replace_contents(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
	}

	_eye_area_pos() {
		let obj = this.area;

		let area_x = 0;
		let area_y = 0;

		do {
			let pos = obj.get_position();

			if (pos) {
				let [tx, ty] = pos;

				area_x += tx;
				area_y += ty;
			}

			obj = obj.get_parent();
		} while (obj);

		return [area_x, area_y];
	}

	_click_animation(clickType, color) {
		let icon = this._get_icon_cached(this.data_dir, this.mouse_click_mode, clickType, color);

		if (icon) {
			let options = {
				icon_size: this.mouse_click_image_size,
				opacity: this.mouse_click_opacity,
				timeout: this.fade_timeout,
			};

			ClickAnimationModeFactory
				.createClickAnimationMode(this.click_animation_mode)
				.animateClick(icon, options);
		}
	}

	_eye_draw(area) {
		const foreground_color = this.area.get_theme_node().get_foreground_color();
		const [mouse_x, mouse_y, _] = global.get_pointer();
		const [area_x, area_y] = this._eye_area_pos();

		let options = {
			area_x: area_x,
			area_y: area_y,
			mouse_x: mouse_x,
			mouse_y: mouse_y,
			eye_color: foreground_color,
			iris_color: foreground_color,
			pupil_color: foreground_color,
			is_eye_active: this.eye_activated,
			line_width: (this.eye_line_width * global.ui_scale),
			padding: (this.eye_vertical_padding * global.ui_scale),
			lids_fill: this.fill_lids_color_painting,
			bulb_fill: this.fill_bulb_color_painting,
		};

		if (this.eye_activated) {
			let [ok, color] = Clutter.Color.from_string(this.eye_clicked_color);
			options.eye_color = ok ? color : options.eye_color;

			[ok, color] = Clutter.Color.from_string(this.iris_clicked_color);
			options.iris_color = ok ? color : options.iris_color;

			[ok, color] = Clutter.Color.from_string(this.pupil_clicked_color);
			options.pupil_color = ok ? color : options.pupil_color;
		}

		EyeModeFactory.createEyeMode(this.eye_mode).drawEye(area, options);
	}

	_mouse_click_event(event) {
		switch (event.type) {
			case 'mouse:button:1p':
				if (this.mouse_left_click_enable)
					this.click_debounced('left_click', this.mouse_left_click_color);
				break;
			case 'mouse:button:2p':
				if (this.mouse_middle_click_enable)
					this.click_debounced('middle_click', this.mouse_middle_click_color);
				break;
			case 'mouse:button:3p':
				if (this.mouse_right_click_enable)
					this.click_debounced('right_click', this.mouse_right_click_color);
				break;
		}
	}

	_eye_timeout() {
		if (this._eye_should_redraw())
			this.area.queue_repaint();
		return true;
	}

	_eye_should_redraw() {
		const [mouse_x, mouse_y, _] = global.get_pointer();

		let should_redraw = true;
		if (this._last_mouse_x == mouse_x && this._last_mouse_y == mouse_y) {
			should_redraw = false;
		} else if (this._last_mouse_x == undefined || this._last_mouse_y == undefined) {
			should_redraw = true;
		} else {
			const dist = (x, y) => Math.sqrt(x * x + y * y);
			const [ox, oy] = this._eye_area_pos();
			const [last_x, last_y] = [this._last_mouse_x - ox, this._last_mouse_y - oy];
			const [current_x, current_y] = [mouse_x - ox, mouse_y - oy];
			const dist_prod = dist(last_x, last_y) * dist(current_x, current_y);

			if (dist_prod == 0) {
				should_redraw = true;
			} else {
				const dot_prod = current_x * last_x + current_y * last_y;
				const angle = Math.acos(dot_prod / dist_prod);
				should_redraw = angle >= this.eye_repaint_angle;
			}
		}

		if (should_redraw) {
			this._last_mouse_x = mouse_x;
			this._last_mouse_y = mouse_y;
		}

		return should_redraw;
	}
}

function main(metadata, orientation, panelHeight, instanceId) {
	return new Eye(metadata, orientation, panelHeight, instanceId);
}
