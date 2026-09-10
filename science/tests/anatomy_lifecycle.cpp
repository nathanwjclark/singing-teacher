// SPDX-License-Identifier: AGPL-3.0-or-later
#include "VocalTractLabApi.h"
#include <cmath>

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    for (int repeat = 0; repeat < 8; ++repeat) {
        if (vtlInitialize(argv[1])) return 2;
        double anatomy[13];
        if (vtlGetAnatomyParams(anatomy)) return 3;
        anatomy[6] = 4.4;
        anatomy[8] = 6.7;
        if (vtlSetAnatomyParams(anatomy)) return 4;
        double readback[13];
        if (vtlGetAnatomyParams(readback)) return 5;
        if (std::abs(readback[6] - 4.4) > 1e-8) return 6;
        if (vtlClose()) return 7;
    }
    return 0;
}
