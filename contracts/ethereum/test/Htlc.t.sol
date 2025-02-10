// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Test, console} from "../lib/forge-std/src/Test.sol";
import {Htlc} from "../src/Htlc.sol";

contract test_Htlc is Test {
    Htlc public htlc;

    address payable public claimer = payable(0x6F7a963dc0379a387f71C0fCe758f2A0D6b506b5);
    bytes32 public secret = 0xd115e2ed2c224310de4a468136c0a85bc10b5c9b2c52d8cd8124fe6ebc447b0f;
// secret = mydog

    function setUp() public {
        htlc = new Htlc();
        htlc.initiateSwap{value: 5 ether}(secret, claimer);
    }


    
    function testInitiation() public{
        vm.expectRevert("The swap have already been initiated");
        htlc.initiateSwap{value: 2 ether}(secret, claimer);   
    }

    function testWithdrawDeniedTest() public {

        vm.prank(claimer);
        vm.expectRevert("Wrong secret");
        htlc.withdrawFunds("bigdogo");
    }

    function testTimeWithdrawDenied() public {
        vm.prank(claimer);
        vm.expectRevert('Please wait at least 1 hour since the initiation of the swap');
        htlc.timeWithdraw();
    }


    function testWithdrawSuccess() public {
        vm.prank(claimer);
        htlc.withdrawFunds("mydog");
        assertEq(address(claimer).balance, 5 ether, "The claimer should have received 5 ether");
    }



}
