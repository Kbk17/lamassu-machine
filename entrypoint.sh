#!/bin/sh

nginx && ./bin/lamassu-machine --mockBillValidator --mockBillDispenser --mockCam --docker
