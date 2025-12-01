#!/usr/bin/env sh
# shellcheck disable=SC3043

set -e

### CHANGE CONFIGURATION AT THE END OF THE FILE ###

check_screen_rotation() {
	local expected_rotation="$1"
	local re='^\([^ ]\+\) \(connected\) \(primary\) \([0-9]\+x[0-9]\+\)+0+0 \(([^)]\+)\) \([^ ]\+\) .*$'
	local actual_rotation=""
	actual_rotation="$(xrandr --query --verbose | grep "${re}" | sed "s|${re}|\6|;")"
	[ "${expected_rotation}" = "${actual_rotation}" ]
}

configure_screen() {
	local rotation="$1"
	case "${rotation}" in
		normal) touchRotation='1 0 0 0 1 0 0 0 1';;
		left) touchRotation='0 -1 1 1 0 0 0 0 1';;
		right) touchRotation='0 1 0 -1 0 1 0 0 1';;
		*) echo "Unknown rotation '${rotation}'..."; exit 1;;
	esac
	screenRotation="${rotation}"

	while true; do
		xrandr -o "${screenRotation}"
		if check_screen_rotation "${screenRotation}"; then
			break
		fi
		sleep 1
	done \
		&& xset s off \
		&& xset s noblank \
		&& xset -dpms
}

configure_touch() {
	local screen="$1"
	# shellcheck disable=SC2086
	xinput set-prop "${screen}" --type=float 'Coordinate Transformation Matrix' $touchRotation
}

### CHANGE CONFIGURATION BELOW TO MATCH THE CONNECTED SCREEN ###

# One of: normal, left, right
configure_screen left
# Find the screen name under "Virtual core pointer" of the following command:
#   xinput list
configure_touch 'ILITEK ILITEK-TP'
